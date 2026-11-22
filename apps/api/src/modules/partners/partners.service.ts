import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  isValidCnpj,
  normalizeEmail,
  ROLE_DEFAULT_PERMISSIONS,
  type PartnerApplicationCreatedDto,
  type PartnerApplicationDto,
  type PartnerApplicationsPage,
  type PartnerApplicationStatus,
} from '@filafacil/shared';
import { BRAND_NAME } from '../../common/brand.js';
import { badRequest, conflict, notFound, unauthorized, unprocessable } from '../../common/http/app-error.js';
import { maskEmail } from '../../common/masking.js';
import { pageArgs } from '../../common/pagination/page-query.dto.js';
import { lockResource } from '../../database/advisory-lock.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ChangeLogService } from '../establishment-history/change-log.service.js';
import { InboxService } from '../inbox/inbox.service.js';
import { EmailSender } from '../notifications/message-senders.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { detectDocumentType, PrivateDocumentStorage } from '../storage/private-document-storage.js';
import type { ListPartnerApplicationsQueryDto, PartnerApplicationDto as PartnerApplicationInputDto, UpdatePartnerApplicationDto } from './partners.dto.js';

export const MAX_PARTNER_DOCUMENTS = 5;
export const MAX_PARTNER_DOCUMENT_BYTES = 5 * 1024 * 1024;
const OPEN_STATUSES: PartnerApplicationStatus[] = ['pending', 'needs_info'];

const INCLUDE = { documents: { orderBy: { createdAt: 'asc' } } } satisfies Prisma.PartnerApplicationInclude;
type Row = Prisma.PartnerApplicationGetPayload<{ include: typeof INCLUDE }>;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const toMinutes = (hhmm: string) => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};
const toHHMM = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Funcionamento diário do cadastro em faixas por dia da semana; passar da meia-noite vira duas faixas. */
export function dailyRanges(opensAt: number, closesAt: number) {
  return Array.from({ length: 7 }, (_, weekday) =>
    closesAt > opensAt
      ? [{ weekday, opensAt, closesAt }]
      : [
          { weekday, opensAt, closesAt: 1440 },
          { weekday: (weekday + 1) % 7, opensAt: 0, closesAt },
        ],
  ).flat();
}

const toDto = (row: Row): PartnerApplicationDto => ({
  id: row.id,
  number: row.number,
  status: row.status,
  businessName: row.businessName,
  type: row.type,
  document: row.document,
  city: row.city,
  address: row.address,
  latitude: row.latitude,
  longitude: row.longitude,
  opensAt: toHHMM(row.opensAt),
  closesAt: row.closesAt === 1440 ? '00:00' : toHHMM(row.closesAt),
  contactName: row.contactName,
  contactEmail: row.contactEmail,
  contactPhone: row.contactPhone,
  notes: row.notes,
  infoRequest: row.infoRequest,
  decisionReason: row.decisionReason,
  establishmentId: row.establishmentId,
  documents: row.documents.map(doc => ({ id: doc.id, fileName: doc.fileName, contentType: doc.contentType, sizeBytes: doc.sizeBytes, createdAt: doc.createdAt.toISOString() })),
  createdAt: row.createdAt.toISOString(),
  reviewedAt: row.reviewedAt?.toISOString() ?? null,
});

/**
 * Ficha 55: cadastro de novo parceiro e a fila de aprovação da plataforma. O solicitante não tem conta ainda: recebe
 * um token de acompanhamento (guardado só como hash) para ver o status, enviar documentos e responder a pedidos de
 * informação. Aprovar cria a rede, o estabelecimento (ativo, pronto para pedidos) e a conta de gestor do contato.
 */
@Injectable()
export class PartnersService {
  private readonly logger = new Logger(PartnersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: PrivateDocumentStorage,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly changeLog: ChangeLogService,
    private readonly inbox: InboxService,
    private readonly realtime: RealtimeService,
    private readonly email: EmailSender,
  ) {}

  // ─── Solicitante ──────────────────────────────────────────────────────────

  async apply(dto: PartnerApplicationInputDto): Promise<PartnerApplicationCreatedDto> {
    await this.settings.assertEnabled('features.partnerSignup', 'O cadastro de novos parceiros está fechado no momento.');
    this.assertDocument(dto.document);
    const open = await this.prisma.partnerApplication.count({ where: { document: dto.document, status: { in: OPEN_STATUSES } } });
    if (open) throw conflict('APPLICATION_EXISTS', 'Já existe um cadastro em análise para este CNPJ. Use o código de acompanhamento recebido.');
    const token = randomBytes(24).toString('base64url');
    const row = await this.prisma.partnerApplication.create({
      data: { ...this.fields(dto), notes: dto.notes ?? '', trackingTokenHash: hashToken(token) },
      include: INCLUDE,
    });
    await this.sendEmail(row.contactEmail, `Cadastro #${row.number} recebido`, `recebemos o cadastro de ${row.businessName}. Acompanhe a análise com o código que apareceu na tela ao enviar.`);
    return { application: toDto(row), trackingToken: token };
  }

  async byToken(token: string | undefined): Promise<PartnerApplicationDto> {
    return toDto(await this.findByToken(token));
  }

  /** Corrige dados (ou responde ao pedido de informação): volta para a fila como "aguardando análise". */
  async updateByToken(token: string | undefined, dto: UpdatePartnerApplicationDto): Promise<PartnerApplicationDto> {
    const row = await this.findByToken(token);
    this.assertEditable(row);
    if (dto.document) this.assertDocument(dto.document);
    const updated = await this.prisma.partnerApplication.update({
      where: { id: row.id },
      data: { ...this.fields({ ...toDto(row), ...dto }), ...(dto.notes !== undefined && { notes: dto.notes }), status: 'pending' },
      include: INCLUDE,
    });
    return toDto(updated);
  }

  async addDocument(token: string | undefined, file: Express.Multer.File | undefined): Promise<PartnerApplicationDto> {
    const row = await this.findByToken(token);
    this.assertEditable(row);
    if (!file?.buffer.length) throw badRequest('MISSING_FILE', 'Selecione o documento.');
    if (file.size > MAX_PARTNER_DOCUMENT_BYTES) throw unprocessable('FILE_TOO_LARGE', 'O documento deve ter até 5 MB.');
    const type = detectDocumentType(file.buffer);
    if (!type) throw unprocessable('UNSUPPORTED_DOCUMENT', 'Envie PDF, PNG, JPG ou WEBP.');
    if (row.documents.length >= MAX_PARTNER_DOCUMENTS) throw conflict('TOO_MANY_DOCUMENTS', `Envie no máximo ${MAX_PARTNER_DOCUMENTS} documentos.`);
    const key = await this.documents.save(file.buffer, type.extension);
    const fileName = (file.originalname || `documento.${type.extension}`).replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(0, 120);
    await this.prisma.partnerDocument.create({ data: { applicationId: row.id, fileName, contentType: type.contentType, sizeBytes: file.size, storageKey: key } });
    return this.byToken(token);
  }

  // ─── Plataforma ───────────────────────────────────────────────────────────

  async list(query: ListPartnerApplicationsQueryDto): Promise<PartnerApplicationsPage> {
    const where: Prisma.PartnerApplicationWhereInput = query.status ? { status: query.status } : {};
    const [rows, total, grouped] = await Promise.all([
      // A fila é atendida por ordem de chegada.
      this.prisma.partnerApplication.findMany({ where, include: INCLUDE, orderBy: { createdAt: query.status && !OPEN_STATUSES.includes(query.status) ? 'desc' : 'asc' }, ...pageArgs(query) }),
      this.prisma.partnerApplication.count({ where }),
      this.prisma.partnerApplication.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const counts: Record<PartnerApplicationStatus, number> = { pending: 0, needs_info: 0, approved: 0, rejected: 0 };
    for (const group of grouped) counts[group.status] = group._count._all;
    return { items: rows.map(toDto), page: query.page, pageSize: query.pageSize, total, counts };
  }

  async get(id: string): Promise<PartnerApplicationDto> {
    return toDto(await this.find(id));
  }

  async document(id: string, documentId: string) {
    const doc = await this.prisma.partnerDocument.findFirst({ where: { id: documentId, applicationId: id } });
    if (!doc) throw notFound('Documento não encontrado.');
    return { content: await this.documents.read(doc.storageKey), contentType: doc.contentType, fileName: doc.fileName };
  }

  async approve(id: string, planId: string, actor: AuthContext): Promise<PartnerApplicationDto> {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId }, select: { id: true, name: true } });
    if (!plan) throw unprocessable('INVALID_PLAN', 'Plano não encontrado.');
    const result = await this.prisma.$transaction(async tx => {
      await lockResource(tx, `partner:${id}`);
      const row = await tx.partnerApplication.findUnique({ where: { id }, include: INCLUDE });
      if (!row) throw notFound('Cadastro não encontrado.');
      this.assertEditable(row);

      const organizationName = (await tx.organization.count({ where: { name: row.businessName } })) ? `${row.businessName} #${row.number}` : row.businessName;
      const organization = await tx.organization.create({ data: { name: organizationName }, select: { id: true, name: true } });
      const establishment = await tx.establishment.create({
        data: {
          name: row.businessName,
          type: row.type,
          city: row.city,
          address: row.address,
          latitude: row.latitude,
          longitude: row.longitude,
          organizationId: organization.id,
          planId: plan.id,
          status: 'active',
          ordersPaused: false,
          openingHours: { create: dailyRanges(row.opensAt, row.closesAt) },
        },
        select: { id: true, name: true },
      });

      const email = normalizeEmail(row.contactEmail);
      let user = await tx.user.findUnique({ where: { email }, select: { id: true, role: true, deletedAt: true } });
      if (user?.deletedAt) user = null;
      if (!user) {
        const phoneTaken = await tx.user.count({ where: { phone: row.contactPhone } });
        user = await tx.user.create({
          data: {
            name: row.contactName,
            email,
            phone: phoneTaken ? null : row.contactPhone,
            role: 'manager',
            permissions: { create: ROLE_DEFAULT_PERMISSIONS.manager.map(permission => ({ permission })) },
          },
          select: { id: true, role: true, deletedAt: true },
        });
      } else if (user.role === 'client') {
        // O cliente que se cadastrou como parceiro passa a gestor (mesma conta, permissões padrão de gestor).
        await tx.userPermission.deleteMany({ where: { userId: user.id } });
        await tx.user.update({ where: { id: user.id }, data: { role: 'manager', permissions: { create: ROLE_DEFAULT_PERMISSIONS.manager.map(permission => ({ permission })) } } });
      }
      await tx.establishmentMembership.createMany({ data: [{ userId: user.id, establishmentId: establishment.id, organizationId: organization.id }], skipDuplicates: true });
      if (user.role !== 'admin') await tx.organizationMember.create({ data: { organizationId: organization.id, userId: user.id, role: 'admin' } });

      await tx.partnerApplication.update({ where: { id }, data: { status: 'approved', establishmentId: establishment.id, reviewedById: actor.userId, reviewedAt: new Date(), infoRequest: null } });
      await this.changeLog.record(tx, establishment.id, { userId: actor.userId, name: actor.name }, [
        { field: 'created', oldValue: null, newValue: { name: establishment.name, plan: plan.name, organization: organization.name, partnerApplication: row.number } },
      ]);
      await this.audit.record(
        { action: 'partner.approved', targetType: 'partner_application', targetId: id, summary: `Parceiro ${row.businessName} (#${row.number}) aprovado no plano ${plan.name}`, details: { establishmentId: establishment.id, planId: plan.id } },
        tx,
      );
      return { row, establishmentId: establishment.id, userId: user.id };
    });

    this.realtime.restaurantUpdated(result.establishmentId);
    this.realtime.staffAccessChanged(result.userId);
    await this.inbox.notifyUser(result.userId, {
      kind: 'partner_approved',
      title: 'Cadastro aprovado',
      body: `${result.row.businessName} foi aprovado e já pode receber pedidos. Cadastre o cardápio no painel do gestor.`,
      refId: result.establishmentId,
      dedupeKey: `partner-approved:${id}`,
    });
    await this.sendEmail(
      result.row.contactEmail,
      'Cadastro aprovado',
      `${result.row.businessName} foi aprovado e já pode receber pedidos. Entre no painel com o e-mail ${normalizeEmail(result.row.contactEmail)} (use "Entrar com código" ou "Esqueci a senha" no primeiro acesso).`,
    );
    return this.get(id);
  }

  async reject(id: string, reason: string): Promise<PartnerApplicationDto> {
    const row = await this.decide(id, 'rejected', { decisionReason: reason }, 'partner.rejected', name => `Parceiro ${name} recusado`);
    await this.sendEmail(row.contactEmail, 'Cadastro não aprovado', `o cadastro de ${row.businessName} não foi aprovado. Motivo: ${reason}`);
    return toDto(row);
  }

  async requestInfo(id: string, message: string): Promise<PartnerApplicationDto> {
    const row = await this.decide(id, 'needs_info', { infoRequest: message }, 'partner.info_requested', name => `Mais informações pedidas a ${name}`);
    await this.sendEmail(row.contactEmail, 'Precisamos de mais informações', `para continuar a análise de ${row.businessName}: ${message} Responda pela página de acompanhamento do cadastro.`);
    return toDto(row);
  }

  // ─── Internos ─────────────────────────────────────────────────────────────

  private async decide(
    id: string,
    status: 'rejected' | 'needs_info',
    data: Prisma.PartnerApplicationUpdateInput,
    action: 'partner.rejected' | 'partner.info_requested',
    summary: (name: string) => string,
  ): Promise<Row> {
    return this.prisma.$transaction(async tx => {
      await lockResource(tx, `partner:${id}`);
      const row = await tx.partnerApplication.findUnique({ where: { id }, include: INCLUDE });
      if (!row) throw notFound('Cadastro não encontrado.');
      this.assertEditable(row);
      const updated = await tx.partnerApplication.update({ where: { id }, data: { ...data, status, ...(status === 'rejected' && { reviewedAt: new Date() }) }, include: INCLUDE });
      const message = (data.decisionReason ?? data.infoRequest) as string;
      await this.audit.record({ action, targetType: 'partner_application', targetId: id, summary: summary(row.businessName), details: { message } }, tx);
      return updated;
    });
  }

  private fields(dto: Omit<PartnerApplicationInputDto, 'notes'>) {
    const opensAt = toMinutes(dto.opensAt);
    const closesAt = dto.closesAt === '00:00' ? 1440 : toMinutes(dto.closesAt);
    if (opensAt === closesAt) throw unprocessable('INVALID_HOURS', 'Abertura e fechamento não podem ser iguais.', [{ field: 'closesAt', message: 'Horário inválido.' }]);
    return {
      businessName: dto.businessName,
      type: dto.type,
      document: dto.document,
      city: dto.city,
      address: dto.address,
      latitude: dto.latitude,
      longitude: dto.longitude,
      opensAt,
      closesAt,
      contactName: dto.contactName,
      contactEmail: normalizeEmail(dto.contactEmail),
      contactPhone: dto.contactPhone,
    };
  }

  private assertDocument(document: string) {
    if (!isValidCnpj(document)) throw unprocessable('INVALID_DOCUMENT', 'CNPJ inválido.', [{ field: 'document', message: 'Confira os dígitos do CNPJ.' }]);
  }

  private assertEditable(row: { status: PartnerApplicationStatus }) {
    if (!OPEN_STATUSES.includes(row.status)) throw conflict('APPLICATION_CLOSED', 'Este cadastro já foi analisado.');
  }

  private async findByToken(token: string | undefined): Promise<Row> {
    if (!token || token.length < 20 || token.length > 64) throw unauthorized('INVALID_TRACKING_TOKEN', 'Código de acompanhamento inválido.');
    const row = await this.prisma.partnerApplication.findUnique({ where: { trackingTokenHash: hashToken(token) }, include: INCLUDE });
    if (!row) throw unauthorized('INVALID_TRACKING_TOKEN', 'Código de acompanhamento inválido.');
    return row;
  }

  private async find(id: string): Promise<Row> {
    const row = await this.prisma.partnerApplication.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw notFound('Cadastro não encontrado.');
    return row;
  }

  /** Aviso ao contato do cadastro (ainda sem conta verificada): best-effort, nunca desfaz a decisão. */
  private async sendEmail(to: string, subject: string, body: string) {
    if (!this.email.available) {
      this.logger.warn(`Aviso de cadastro de parceiro sem provedor de e-mail (${subject}).`);
      return;
    }
    try {
      await this.email.send(to, maskEmail(to), `${BRAND_NAME}: ${body}`, { subject });
    } catch (error) {
      this.logger.warn(`Falha ao avisar o parceiro (${maskEmail(to)}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
