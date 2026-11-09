import { Injectable } from '@nestjs/common';
import type { Permission, StaffAlertDto, StaffAlertKind } from '@filafacil/shared';
import { conflict, notFound } from '../../common/http/app-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';

/** Quem enxerga cada tipo de alerta (basta uma das permissões). */
const VISIBLE_TO: Record<StaffAlertKind, Permission[]> = {
  printer_offline: ['kitchen.manage', 'orders.manage'],
  low_stock: ['stock.manage'],
  tab_refund_pending: ['tabs.manage'],
  stock_shortfall: ['stock.manage'],
  ingredient_expiring: ['recipes.manage', 'stock.manage'],
};

/**
 * Alertas in-app da equipe (fichas 26 e 50). Há no máximo um alerta aberto por (tipo, referência):
 * repetir `open` enquanto aberto não cria outro (índice parcial no banco) nem avisa de novo.
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Abre o alerta se ainda não houver um aberto. Devolve true quando criou. */
  async open(establishmentId: string, kind: StaffAlertKind, refId: string, message: string): Promise<boolean> {
    try {
      await this.prisma.staffAlert.create({ data: { establishmentId, kind, refId, message: message.slice(0, 200) } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
    this.realtime.alertsUpdated(establishmentId);
    return true;
  }

  /** Fecha o alerta aberto (se houver). Devolve true quando fechou algum. */
  async resolve(establishmentId: string, kind: StaffAlertKind, refId: string): Promise<boolean> {
    const { count } = await this.prisma.staffAlert.updateMany({ where: { establishmentId, kind, refId, resolvedAt: null }, data: { resolvedAt: new Date() } });
    if (count > 0) this.realtime.alertsUpdated(establishmentId);
    return count > 0;
  }

  async list(establishmentId: string, permissions: ReadonlySet<Permission>): Promise<StaffAlertDto[]> {
    const kinds = (Object.keys(VISIBLE_TO) as StaffAlertKind[]).filter(kind => VISIBLE_TO[kind].some(permission => permissions.has(permission)));
    const rows = await this.prisma.staffAlert.findMany({ where: { establishmentId, resolvedAt: null, dismissedAt: null, kind: { in: kinds } }, orderBy: { createdAt: 'desc' } });
    const refundIds = rows.filter(row => row.kind === 'tab_refund_pending').map(row => row.refId);
    const tabOf = new Map<string, string>();
    if (refundIds.length) {
      for (const payment of await this.prisma.tabPayment.findMany({ where: { id: { in: refundIds } }, select: { id: true, tabId: true } })) tabOf.set(payment.id, payment.tabId);
      // Pagamento individual em duplicidade: a comanda é a do pedido.
      for (const payment of await this.prisma.payment.findMany({ where: { id: { in: refundIds } }, select: { id: true, order: { select: { tabId: true } } } })) {
        if (payment.order.tabId) tabOf.set(payment.id, payment.order.tabId);
      }
    }
    return rows.map(row => ({ id: row.id, kind: row.kind, refId: row.refId, tabId: tabOf.get(row.refId) ?? null, message: row.message, createdAt: row.createdAt.toISOString() }));
  }

  async dismiss(establishmentId: string, alertId: string, permissions: ReadonlySet<Permission>): Promise<void> {
    const alert = await this.prisma.staffAlert.findFirst({ where: { id: alertId, establishmentId, resolvedAt: null } });
    if (!alert || !VISIBLE_TO[alert.kind].some(permission => permissions.has(permission))) throw notFound('Alerta não encontrado.');
    // Estorno pendente só some quando o estorno é concluído (retry): dispensar esconderia dinheiro retido.
    if (alert.kind === 'tab_refund_pending') throw conflict('ALERT_NOT_DISMISSIBLE', 'Este alerta só some quando o estorno for concluído.');
    // Dispensar silencia: o alerta continua aberto (não reabre outro) até a condição normalizar.
    await this.prisma.staffAlert.updateMany({ where: { id: alertId, resolvedAt: null }, data: { dismissedAt: new Date() } });
    this.realtime.alertsUpdated(establishmentId);
  }
}
