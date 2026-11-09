import { Injectable, Logger } from '@nestjs/common';
import type { AppNotificationKind, AppNotificationsDto, Permission } from '@filafacil/shared';
import { BRAND_NAME } from '../../common/brand.js';
import { maskEmail } from '../../common/masking.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { EmailSender } from '../notifications/message-senders.js';
import { RealtimeService } from '../realtime/realtime.service.js';

export interface NotificationInput {
  kind: AppNotificationKind;
  title: string;
  body: string;
  refId?: string | null;
  /** Único: repetir o mesmo aviso (mesmo fato) não cria outro. */
  dedupeKey?: string;
  /** Também envia por e-mail (só para contas com e-mail verificado; falha nunca derruba o fluxo). */
  email?: boolean;
}

const LIST_LIMIT = 50;

/**
 * Avisos in-app (fichas 30, 38, 39, 48, 70): do cliente (por conta) ou da equipe (por estabelecimento, filtrados
 * pela permissão). O e-mail é um canal extra, best-effort: a falha é registrada e nunca vira "sucesso" nem derruba a regra de negócio.
 */
@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly emailSender: EmailSender,
  ) {}

  /** Devolve true quando criou agora (false = já existia pelo `dedupeKey`). */
  async notifyUser(userId: string, input: NotificationInput): Promise<boolean> {
    if (!(await this.create({ userId }, input))) return false;
    this.realtime.notificationsUpdated({ userId });
    if (input.email) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
      if (user?.email && user.emailVerifiedAt) await this.sendEmail(user.email, input);
    }
    return true;
  }

  async notifyEstablishment(establishmentId: string, input: NotificationInput & { requiredPermission?: Permission }): Promise<boolean> {
    if (!(await this.create({ establishmentId, requiredPermission: input.requiredPermission ?? null }, input))) return false;
    this.realtime.notificationsUpdated({ establishmentId });
    if (input.email) {
      const managers = await this.prisma.user.findMany({
        where: { role: 'manager', status: 'active', deletedAt: null, emailVerifiedAt: { not: null }, email: { not: null }, memberships: { some: { establishmentId } } },
        select: { email: true },
      });
      for (const manager of managers) if (manager.email) await this.sendEmail(manager.email, input);
    }
    return true;
  }

  private async create(target: { userId?: string; establishmentId?: string; requiredPermission?: string | null }, input: NotificationInput): Promise<boolean> {
    try {
      await this.prisma.appNotification.create({
        data: {
          userId: target.userId,
          establishmentId: target.establishmentId,
          requiredPermission: target.requiredPermission ?? null,
          kind: input.kind,
          title: input.title.slice(0, 120),
          body: input.body.slice(0, 400),
          refId: input.refId ?? null,
          dedupeKey: input.dedupeKey,
        },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
  }

  private async sendEmail(to: string, input: NotificationInput) {
    if (!this.emailSender.available) {
      this.logger.warn(`Aviso por e-mail (${input.kind}) sem provedor disponível.`);
      return;
    }
    try {
      await this.emailSender.send(to, maskEmail(to), `${BRAND_NAME}: ${input.body}`, { subject: input.title });
    } catch (error) {
      this.logger.warn(`Falha ao enviar aviso por e-mail (${input.kind}, ${maskEmail(to)}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ─── Leitura ──────────────────────────────────────────────────────────────

  async listForUser(userId: string): Promise<AppNotificationsDto> {
    const [unread, rows] = await Promise.all([
      this.prisma.appNotification.count({ where: { userId, readAt: null } }),
      this.prisma.appNotification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: LIST_LIMIT }),
    ]);
    return { unread, items: rows.map(toDto) };
  }

  async markUserRead(userId: string, ids?: string[]): Promise<void> {
    await this.prisma.appNotification.updateMany({ where: { userId, readAt: null, ...(ids && { id: { in: ids } }) }, data: { readAt: new Date() } });
    this.realtime.notificationsUpdated({ userId });
  }

  async listForStaff(establishmentId: string, permissions: ReadonlySet<Permission>): Promise<AppNotificationsDto> {
    const where = this.staffWhere(establishmentId, permissions);
    const [unread, rows] = await Promise.all([
      this.prisma.appNotification.count({ where: { ...where, readAt: null } }),
      this.prisma.appNotification.findMany({ where, orderBy: { createdAt: 'desc' }, take: LIST_LIMIT }),
    ]);
    return { unread, items: rows.map(toDto) };
  }

  async markStaffRead(establishmentId: string, permissions: ReadonlySet<Permission>, ids?: string[]): Promise<void> {
    await this.prisma.appNotification.updateMany({ where: { ...this.staffWhere(establishmentId, permissions), readAt: null, ...(ids && { id: { in: ids } }) }, data: { readAt: new Date() } });
    this.realtime.notificationsUpdated({ establishmentId });
  }

  private staffWhere(establishmentId: string, permissions: ReadonlySet<Permission>): Prisma.AppNotificationWhereInput {
    return { establishmentId, OR: [{ requiredPermission: null }, { requiredPermission: { in: [...permissions] } }] };
  }
}

const toDto = (row: { id: string; kind: string; title: string; body: string; refId: string | null; readAt: Date | null; createdAt: Date }) => ({
  id: row.id,
  kind: row.kind as AppNotificationKind,
  title: row.title,
  body: row.body,
  refId: row.refId,
  read: row.readAt !== null,
  createdAt: row.createdAt.toISOString(),
});
