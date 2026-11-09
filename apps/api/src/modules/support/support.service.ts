import { Injectable } from '@nestjs/common';
import {

  type CreateSupportTicketRequest,
  type Page,
  type SupportPriority,
  type SupportStatus,
  type SupportTicketDetailDto,
  type SupportTicketDto,
} from '@filafacil/shared';
import { notFound } from '../../common/http/app-error.js';
import { pageArgs, toPage, type PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { InboxService } from '../inbox/inbox.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const TICKET_INCLUDE = {
  establishment: { select: { name: true } },
  messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { side: true } },
  _count: { select: { messages: true } },
} satisfies Prisma.SupportTicketInclude;
type TicketRow = Prisma.SupportTicketGetPayload<{ include: typeof TICKET_INCLUDE }>;

const toDto = (row: TicketRow): SupportTicketDto => ({
  id: row.id,
  number: row.number,
  establishmentId: row.establishmentId,
  establishmentName: row.establishment.name,
  subject: row.subject,
  priority: row.priority,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  lastMessageAt: row.lastMessageAt.toISOString(),
  messageCount: row._count.messages,
  awaitingPlatform: row.status !== 'resolved' && row.messages[0]?.side === 'establishment',
});

export interface AdminTicketsQuery extends PageQueryDto {
  /** `active` = abertos e em andamento (padrão), `resolved` = resolvidos, `all`. */
  scope?: 'active' | 'resolved' | 'all';
  priority?: SupportPriority;
  status?: SupportStatus;
  q?: string;
}

/**
 * Central de suporte (ficha 39). A casa abre chamados com urgência e conversa com a plataforma; a plataforma atende
 * por fila priorizada (urgência decrescente, depois o mais antigo) e cada resposta avisa a casa (aviso in-app + e-mail).
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly inbox: InboxService,
  ) {}

  // ─── Plataforma ───────────────────────────────────────────────────────────

  async listForAdmin(query: AdminTicketsQuery): Promise<Page<SupportTicketDto> & { counts: Record<SupportStatus | 'urgentOpen' | 'awaiting', number> }> {
    const scope = query.scope ?? 'active';
    const where: Prisma.SupportTicketWhereInput = {
      ...(scope === 'active' && { status: { in: ['open', 'in_progress'] } }),
      ...(scope === 'resolved' && { status: 'resolved' }),
      ...(query.status && { status: query.status }),
      ...(query.priority && { priority: query.priority }),
      ...(query.q && { OR: [{ subject: { contains: query.q, mode: 'insensitive' } }, { establishment: { name: { contains: query.q, mode: 'insensitive' } } }] }),
    };
    // A ordem do enum (low < normal < high < urgent) é a do banco: urgente primeiro e, entre iguais, o mais antigo.
    const orderBy: Prisma.SupportTicketOrderByWithRelationInput[] = scope === 'active' ? [{ priority: 'desc' }, { createdAt: 'asc' }] : [{ lastMessageAt: 'desc' }];
    const [rows, total, grouped, urgentOpen] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({ where, orderBy, ...pageArgs(query), include: TICKET_INCLUDE }),
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.groupBy({ by: ['status'], orderBy: { status: 'asc' }, _count: { _all: true } }),
      this.prisma.supportTicket.count({ where: { priority: 'urgent', status: { in: ['open', 'in_progress'] } } }),
    ]);
    // Chamados ativos cuja última mensagem é da casa: a plataforma ainda não respondeu.
    const [{ awaiting }] = await this.prisma.$queryRaw<{ awaiting: number }[]>`
      SELECT COUNT(*)::int AS awaiting FROM support_tickets t
      WHERE t.status <> 'resolved'
        AND (SELECT m.side FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) = 'establishment'`;
    const counts = { open: 0, in_progress: 0, resolved: 0, urgentOpen, awaiting: awaiting ?? 0 };
    for (const group of grouped) counts[group.status] = (group._count as { _all: number })._all;
    return { ...toPage(rows.map(toDto), total, query), counts };
  }

  async getForAdmin(id: string): Promise<SupportTicketDetailDto> {
    return this.detail({ id });
  }

  async updateForAdmin(id: string, dto: { status?: SupportStatus; priority?: SupportPriority }): Promise<SupportTicketDetailDto> {
    const current = await this.prisma.supportTicket.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw notFound('Chamado não encontrado.');
    await this.prisma.supportTicket.update({
      where: { id },
      data: { status: dto.status, priority: dto.priority, ...(dto.status && { resolvedAt: dto.status === 'resolved' ? new Date() : null }) },
    });
    const ticket = await this.detail({ id });
    this.realtime.supportUpdated(ticket.establishmentId);
    return ticket;
  }

  /** Resposta da plataforma: abre "em andamento", registra no histórico e avisa a casa a CADA resposta. */
  async replyAsPlatform(id: string, author: { userId: string; name: string }, body: string): Promise<SupportTicketDetailDto> {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id }, select: { id: true, number: true, subject: true, establishmentId: true, status: true } });
    if (!ticket) throw notFound('Chamado não encontrado.');
    const message = await this.prisma.$transaction(async tx => {
      const created = await tx.supportMessage.create({ data: { ticketId: id, authorId: author.userId, authorName: author.name, side: 'platform', body } });
      await tx.supportTicket.update({ where: { id }, data: { lastMessageAt: created.createdAt, ...(ticket.status !== 'in_progress' && { status: 'in_progress', resolvedAt: null }) } });
      return created;
    });
    await this.inbox.notifyEstablishment(ticket.establishmentId, {
      kind: 'support_reply',
      title: `Chamado #${ticket.number} respondido`,
      body: `A plataforma respondeu "${ticket.subject}": ${body.length > 160 ? `${body.slice(0, 157)}…` : body}`,
      refId: id,
      dedupeKey: `support_reply:${message.id}`,
      requiredPermission: 'support.request',
      email: true,
    });
    this.realtime.supportUpdated(ticket.establishmentId);
    return this.detail({ id });
  }

  // ─── Estabelecimento ──────────────────────────────────────────────────────

  async listForEstablishment(establishmentId: string): Promise<SupportTicketDto[]> {
    const rows = await this.prisma.supportTicket.findMany({ where: { establishmentId }, orderBy: [{ lastMessageAt: 'desc' }], take: 100, include: TICKET_INCLUDE });
    return rows.map(toDto);
  }

  async getForEstablishment(establishmentId: string, id: string): Promise<SupportTicketDetailDto> {
    return this.detail({ id, establishmentId });
  }

  async create(establishmentId: string, author: { userId: string; name: string }, dto: CreateSupportTicketRequest): Promise<SupportTicketDetailDto> {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        establishmentId,
        createdById: author.userId,
        subject: dto.subject,
        priority: dto.priority,
        messages: { create: { authorId: author.userId, authorName: author.name, side: 'establishment', body: dto.message } },
      },
      select: { id: true },
    });
    this.realtime.supportUpdated(establishmentId);
    return this.detail({ id: ticket.id });
  }

  /** A casa responde; um chamado resolvido volta a ficar aberto (fila da plataforma). */
  async replyAsEstablishment(establishmentId: string, id: string, author: { userId: string; name: string }, body: string): Promise<SupportTicketDetailDto> {
    const ticket = await this.prisma.supportTicket.findFirst({ where: { id, establishmentId }, select: { status: true } });
    if (!ticket) throw notFound('Chamado não encontrado.');
    await this.prisma.$transaction(async tx => {
      const created = await tx.supportMessage.create({ data: { ticketId: id, authorId: author.userId, authorName: author.name, side: 'establishment', body } });
      await tx.supportTicket.update({ where: { id }, data: { lastMessageAt: created.createdAt, ...(ticket.status === 'resolved' && { status: 'open', resolvedAt: null }) } });
    });
    this.realtime.supportUpdated(establishmentId);
    return this.detail({ id, establishmentId });
  }

  /** A própria casa encerra o chamado quando o problema foi resolvido. */
  async resolveAsEstablishment(establishmentId: string, id: string): Promise<SupportTicketDetailDto> {
    const { count } = await this.prisma.supportTicket.updateMany({ where: { id, establishmentId }, data: { status: 'resolved', resolvedAt: new Date() } });
    if (count === 0) throw notFound('Chamado não encontrado.');
    this.realtime.supportUpdated(establishmentId);
    return this.detail({ id, establishmentId });
  }

  private async detail(where: { id: string; establishmentId?: string }): Promise<SupportTicketDetailDto> {
    const row = await this.prisma.supportTicket.findFirst({ where, include: { ...TICKET_INCLUDE, messages: { orderBy: { createdAt: 'asc' } } } });
    if (!row) throw notFound('Chamado não encontrado.');
    const last = row.messages[row.messages.length - 1];
    return {
      ...toDto({ ...row, messages: last ? [{ side: last.side }] : [] }),
      messageCount: row.messages.length,
      messages: row.messages.map(message => ({ id: message.id, side: message.side as 'platform' | 'establishment', authorName: message.authorName, body: message.body, createdAt: message.createdAt.toISOString() })),
    };
  }
}

