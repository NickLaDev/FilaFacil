import { Injectable, Logger } from '@nestjs/common';
import { describeDevice, type AccessLogDto, type Page, type UserAccessDto } from '@filafacil/shared';
import { sha256Hex } from '../../common/crypto/hashing.js';
import { notFound } from '../../common/http/app-error.js';
import { pageArgs, toPage, type PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { currentRequest, DEVICE_COOKIE, loginMethodFor } from '../../common/request-context.js';
import { maskEmail } from '../../common/masking.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { InboxService } from '../inbox/inbox.service.js';

const ACCESS_INCLUDE = { user: { select: { name: true } } } as const;

/**
 * Log de acessos e dispositivos (ficha 52). Cada login grava data/hora, IP, aparelho (pelo cookie próprio do
 * aparelho, só o hash) e o método. Aparelho nunca visto para a conta = registro marcado como novo + aviso ao titular
 * (in-app e e-mail). O admin vê o histórico e encerra sessões em um clique.
 */
@Injectable()
export class AccessLogService {
  private readonly logger = new Logger(AccessLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  /** Chamado ao criar a sessão. Nunca derruba o login: falha aqui só vai para o log. */
  async recordLogin(userId: string, sessionId: string, userAgent: string | undefined, ipAddress: string | undefined): Promise<void> {
    try {
      const request = currentRequest();
      const deviceId = (request?.cookies as Record<string, string> | undefined)?.[DEVICE_COOKIE];
      // Sem cookie (cliente que não guarda cookies): o aparelho é identificado pelo próprio navegador + IP.
      const deviceHash = sha256Hex(deviceId ? `device:${deviceId}` : `fallback:${userAgent ?? ''}|${ipAddress ?? ''}`);
      const [known, previous] = await Promise.all([
        this.prisma.accessLog.findFirst({ where: { userId, deviceHash }, select: { id: true } }),
        this.prisma.accessLog.count({ where: { userId } }),
      ]);
      const newDevice = !known;
      const deviceLabel = describeDevice(userAgent);
      await this.prisma.accessLog.create({
        data: { userId, sessionId, ipAddress: ipAddress?.slice(0, 64) ?? null, userAgent: userAgent?.slice(0, 255) ?? null, deviceHash, deviceLabel, method: loginMethodFor(request?.originalUrl ?? request?.path), newDevice },
      });
      // O primeiro aparelho da conta não é suspeito; os seguintes, nunca vistos, geram aviso ao titular.
      if (newDevice && previous > 0) {
        const when = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date());
        await this.inbox.notifyUser(userId, {
          kind: 'new_device_login',
          title: 'Novo acesso à sua conta',
          body: `Entraram na sua conta em um dispositivo novo (${deviceLabel}, IP ${ipAddress ?? 'desconhecido'}) em ${when}. Se não foi você, troque a senha e encerre as sessões.`,
          refId: sessionId,
          email: true,
        });
      }
    } catch (error) {
      this.logger.error(`Falha ao registrar acesso: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async list(query: PageQueryDto & { userId?: string; newDevice?: boolean }): Promise<Page<AccessLogDto>> {
    const where = { ...(query.userId && { userId: query.userId }), ...(query.newDevice !== undefined && { newDevice: query.newDevice }) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.accessLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(query), include: ACCESS_INCLUDE }),
      this.prisma.accessLog.count({ where }),
    ]);
    const sessions = await this.activeSessionIds(rows.map(row => row.sessionId));
    return toPage(rows.map(row => this.toDto(row, sessions)), total, query);
  }

  async forUser(userId: string): Promise<UserAccessDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    if (!user) throw notFound('Usuário não encontrado.');
    const now = new Date();
    const [sessions, logins] = await Promise.all([
      this.prisma.session.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.accessLog.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50, include: ACCESS_INCLUDE }),
    ]);
    const active = new Set(sessions.filter(session => !session.revokedAt && session.expiresAt > now).map(session => session.id));
    return {
      userId: user.id,
      userName: user.name,
      sessions: sessions.map(session => ({
        id: session.id,
        deviceLabel: describeDevice(session.userAgent),
        ipAddress: session.ipAddress,
        createdAt: session.createdAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
        active: active.has(session.id),
      })),
      logins: logins.map(row => this.toDto(row, active)),
    };
  }

  /** Encerra uma sessão na hora (a próxima requisição daquele aparelho já é recusada). */
  async revokeSession(sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { id: true, userId: true, revokedAt: true, userAgent: true, user: { select: { name: true, email: true } } } });
    if (!session) throw notFound('Sessão não encontrada.');
    if (!session.revokedAt) await this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date(), revokedReason: 'admin_revoked' } });
    await this.audit.record({
      action: 'session.revoked',
      targetType: 'session',
      targetId: sessionId,
      summary: `Sessão de ${session.user.name}${session.user.email ? ` (${maskEmail(session.user.email)})` : ''} encerrada remotamente — ${describeDevice(session.userAgent)}`,
      details: { userId: session.userId },
    });
  }

  private async activeSessionIds(ids: (string | null)[]) {
    const present = ids.filter((id): id is string => Boolean(id));
    if (!present.length) return new Set<string>();
    const rows = await this.prisma.session.findMany({ where: { id: { in: present }, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
    return new Set(rows.map(row => row.id));
  }

  private toDto(row: { id: string; userId: string; ipAddress: string | null; deviceLabel: string; method: string; newDevice: boolean; sessionId: string | null; createdAt: Date; user: { name: string } }, active: Set<string>): AccessLogDto {
    return {
      id: row.id,
      userId: row.userId,
      userName: row.user.name,
      ipAddress: row.ipAddress,
      deviceLabel: row.deviceLabel,
      method: row.method,
      newDevice: row.newDevice,
      sessionId: row.sessionId,
      sessionActive: Boolean(row.sessionId && active.has(row.sessionId)),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
