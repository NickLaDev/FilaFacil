import { Injectable, Logger } from '@nestjs/common';
import type { CloseTabRequest, CloseTabResponse, OrderSettlement, TabDto } from '@filafacil/shared';
import { AppError, conflict, notFound, unprocessable } from '../../common/http/app-error.js';
import { lockResource } from '../../database/advisory-lock.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { TabPayment } from '../../generated/prisma/client.js';
import { AlertsService } from '../kitchen/alerts.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { GatewayError, PaymentGateway, type GatewayPayment } from '../payments/payment-gateway.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { tableScope } from '../tables/table-state.js';
import { WaitlistService } from '../waitlist/waitlist.service.js';

const STALE_ATTEMPT_MS = 30 * 60 * 1000;
const TRANSACTION = { timeout: 10_000, maxWait: 10_000 };
const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true });

const TAB_INCLUDE = {
  orders: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      number: true,
      status: true,
      totalCents: true,
      tabSettledAt: true,
      items: { orderBy: { name: 'asc' }, select: { menuItemId: true, name: true, quantity: true, unitPriceCents: true, notes: true } },
      payments: { orderBy: { attempt: 'desc' }, take: 1, select: { status: true } },
    },
  },
} satisfies Prisma.TabInclude;
type TabRow = Prisma.TabGetPayload<{ include: typeof TAB_INCLUDE }>;

const gatewayFailure = () => new AppError(502, 'PAYMENT_GATEWAY_ERROR', 'Não conseguimos falar com o provedor de pagamento. Tente novamente em instantes.');

function settlementOf(order: TabRow['orders'][number]): OrderSettlement {
  const payment = order.payments[0];
  if (payment?.status === 'approved') return 'paid';
  if (payment?.status === 'refunded') return 'refunded';
  if (order.tabSettledAt) return 'settled_on_tab';
  return order.status === 'cancelled' ? 'unpaid' : 'on_tab';
}

/** Total, pago e saldo de uma comanda: pedidos cancelados saem; pago = gateway aprovado ou quitado na comanda. */
export function tabTotals(orders: TabRow['orders']) {
  let totalCents = 0;
  let paidCents = 0;
  for (const order of orders) {
    if (order.status === 'cancelled') continue;
    totalCents += order.totalCents;
    const settlement = settlementOf(order);
    if (settlement === 'paid' || settlement === 'settled_on_tab') paidCents += order.totalCents;
  }
  return { totalCents, paidCents, balanceCents: totalCents - paidCents };
}

/**
 * Comandas (fichas 17 e 22). Uma comanda aberta por mesa/grupo mesclado. Pedido do escopo da mesa é pago
 * individualmente (gateway) OU atribuído à comanda para pagamento posterior — pedido não pago nunca é tratado como pago.
 * O fechamento cobra apenas o saldo (total − pago), com idempotência por chave, transação e lock (`tab:<id>`).
 */
@Injectable()
export class TabsService {
  private readonly logger = new Logger(TabsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
    private readonly realtime: RealtimeService,
    private readonly waitlist: WaitlistService,
    private readonly loyalty: LoyaltyService,
    private readonly alerts: AlertsService,
  ) {}

  // ─── Leitura ──────────────────────────────────────────────────────────────

  async list(establishmentId: string, status: 'open' | 'closed' = 'open'): Promise<TabDto[]> {
    const rows = await this.prisma.tab.findMany({ where: { establishmentId, status }, include: TAB_INCLUDE, orderBy: { openedAt: 'desc' }, take: 100 });
    return Promise.all(rows.map(row => this.toDto(row)));
  }

  async get(establishmentId: string, tabId: string): Promise<TabDto> {
    const tab = await this.prisma.tab.findFirst({ where: { id: tabId, establishmentId }, include: TAB_INCLUDE });
    if (!tab) throw notFound('Comanda não encontrada.');
    return this.toDto(tab);
  }

  private async scopeTableIds(tab: { scopeKey: string; tableId: string | null }): Promise<string[]> {
    const grouped = await this.prisma.diningTable.findMany({ where: { OR: [{ groupId: tab.scopeKey }, { id: tab.scopeKey }] }, select: { id: true } });
    if (grouped.length === 0 && tab.tableId) return [tab.tableId];
    return grouped.map(table => table.id);
  }

  private async toDto(tab: TabRow): Promise<TabDto> {
    const totals = tabTotals(tab.orders);
    return {
      id: tab.id,
      label: tab.label,
      status: tab.status,
      tableIds: await this.scopeTableIds(tab),
      openedAt: tab.openedAt.toISOString(),
      closedAt: tab.closedAt?.toISOString() ?? null,
      orders: tab.orders.map(order => ({ id: order.id, number: order.number, status: order.status, totalCents: order.totalCents, settlement: settlementOf(order), items: order.items })),
      ...totals,
    };
  }

  // ─── Abrir e atribuir pedidos (17) ────────────────────────────────────────

  /** Abre a comanda da mesa/grupo ou devolve a que já está aberta (uma por escopo). */
  async openForTable(establishmentId: string, tableId: string, actorId: string): Promise<TabDto> {
    const tabId = await this.prisma.$transaction(async tx => {
      await lockResource(tx, `tables:${establishmentId}`);
      const ids = await tableScope(tx, tableId, establishmentId);
      if (!ids.length) throw notFound('Mesa não encontrada.');
      const tables = (await tx.diningTable.findMany({ where: { id: { in: ids } }, select: { id: true, label: true, groupId: true } })).sort(byLabel);
      const scopeKey = tables[0]?.groupId ?? tables[0]?.id ?? tableId;
      const open = await tx.tab.findFirst({ where: { establishmentId, scopeKey, status: 'open' }, select: { id: true } });
      if (open) return open.id;
      const created = await tx.tab.create({
        data: { establishmentId, scopeKey, tableId: tables[0]?.id, label: tables.map(table => table.label).join(' + '), openedById: actorId },
        select: { id: true },
      });
      return created.id;
    }, TRANSACTION);
    this.realtime.tabsUpdated(establishmentId, tabId);
    return this.get(establishmentId, tabId);
  }

  async assignOrder(establishmentId: string, tabId: string, orderId: string): Promise<TabDto> {
    const userId = await this.prisma.$transaction(async tx => {
      await lockResource(tx, `tab:${tabId}`);
      const tab = await this.openTab(tx, establishmentId, tabId);
      await this.assertNoPaymentInFlight(tx, tabId);
      const order = await tx.order.findFirst({
        where: { id: orderId, establishmentId },
        select: { id: true, userId: true, tableId: true, status: true, tabId: true, payments: { where: { status: 'pending' }, select: { id: true }, take: 1 } },
      });
      if (!order) throw notFound('Pedido não encontrado.');
      const scope = await tx.diningTable.findMany({ where: { OR: [{ groupId: tab.scopeKey }, { id: tab.scopeKey }] }, select: { id: true } });
      if (!order.tableId || !scope.some(table => table.id === order.tableId)) {
        throw unprocessable('ORDER_NOT_ON_TAB_TABLE', 'O pedido não é de uma mesa desta comanda.');
      }
      if (order.status === 'cancelled') throw unprocessable('ORDER_CANCELLED', 'Pedido cancelado não entra na comanda.');
      if (order.tabId && order.tabId !== tabId) throw conflict('ORDER_ALREADY_ON_TAB', 'O pedido já está em outra comanda.');
      if (order.payments.length > 0) throw conflict('ORDER_HAS_PENDING_PAYMENT', 'O pedido tem um pagamento em andamento. Aguarde ou cancele a cobrança.');
      await tx.order.update({ where: { id: orderId }, data: { tabId } });
      return order.userId;
    }, TRANSACTION);
    this.realtime.tabsUpdated(establishmentId, tabId);
    this.realtime.orderUpdated(userId, establishmentId, orderId);
    return this.get(establishmentId, tabId);
  }

  /** Só sai da comanda o pedido que ainda não foi iniciado nem pago. */
  async unassignOrder(establishmentId: string, tabId: string, orderId: string): Promise<TabDto> {
    const userId = await this.prisma.$transaction(async tx => {
      await lockResource(tx, `tab:${tabId}`);
      await this.openTab(tx, establishmentId, tabId);
      await this.assertNoPaymentInFlight(tx, tabId);
      const order = await tx.order.findFirst({ where: { id: orderId, tabId, establishmentId }, select: { userId: true, status: true, tabSettledAt: true } });
      if (!order) throw notFound('Pedido não encontrado nesta comanda.');
      if (order.status !== 'received' || order.tabSettledAt) throw conflict('ORDER_ALREADY_STARTED', 'O pedido já foi iniciado e não pode sair da comanda.');
      await tx.order.update({ where: { id: orderId }, data: { tabId: null } });
      return order.userId;
    }, TRANSACTION);
    this.realtime.tabsUpdated(establishmentId, tabId);
    this.realtime.orderUpdated(userId, establishmentId, orderId);
    return this.get(establishmentId, tabId);
  }

  private async openTab(tx: PrismaTx, establishmentId: string, tabId: string) {
    const tab = await tx.tab.findFirst({ where: { id: tabId, establishmentId } });
    if (!tab) throw notFound('Comanda não encontrada.');
    if (tab.status !== 'open') throw conflict('TAB_CLOSED', 'Esta comanda já foi fechada.');
    return tab;
  }

  private async assertNoPaymentInFlight(tx: PrismaTx, tabId: string) {
    const inFlight = await tx.tabPayment.findFirst({ where: { tabId, status: { in: ['pending', 'approved'] } }, select: { id: true } });
    if (inFlight) throw conflict('TAB_PAYMENT_IN_PROGRESS', 'Há um fechamento de comanda em andamento.');
  }

  // ─── Fechar e pagar (22) ──────────────────────────────────────────────────

  async close(establishmentId: string, tabId: string, dto: CloseTabRequest, actor: { userId: string; email: string | null }): Promise<CloseTabResponse> {
    await this.resolveStale(establishmentId, tabId);
    await this.reviveExpired(establishmentId, tabId);
    await this.resolveStaleOrderPayments(establishmentId, tabId);
    const plan = await this.plan(establishmentId, tabId, dto, actor.userId);
    if (plan.kind === 'replay') return { tab: await this.get(establishmentId, tabId), chargedCents: plan.payment.amountCents, replayed: true };
    let payment = plan.payment;

    if (plan.kind === 'reconcile') {
      payment = await this.reconcile(payment);
    } else if (payment.amountCents > 0) {
      payment = await this.charge(payment, dto, actor.email);
    } else {
      await this.settle(payment.id, null);
    }
    const settled = await this.prisma.tabPayment.findUniqueOrThrow({ where: { id: payment.id } });
    if (settled.status === 'refused') throw unprocessable('PAYMENT_REFUSED', 'O pagamento foi recusado. A comanda continua aberta; tente outra forma de pagamento.');
    if (settled.status !== 'approved') throw gatewayFailure();
    return { tab: await this.get(establishmentId, tabId), chargedCents: settled.amountCents, replayed: false };
  }

  /** Decide o passo olhando só o banco, sob lock da comanda. Grava a tentativa ANTES de falar com o gateway. */
  private plan(establishmentId: string, tabId: string, dto: CloseTabRequest, actorId: string) {
    return this.prisma.$transaction(async tx => {
      await lockResource(tx, `tab:${tabId}`);
      await this.lockTabOrders(tx, tabId);
      const tab = await tx.tab.findFirst({ where: { id: tabId, establishmentId }, include: TAB_INCLUDE });
      if (!tab) throw notFound('Comanda não encontrada.');
      const same = await tx.tabPayment.findUnique({ where: { tabId_idempotencyKey: { tabId, idempotencyKey: dto.idempotencyKey } } });
      if (same) {
        if (same.status === 'approved') return { kind: 'replay' as const, payment: same };
        if (same.status === 'pending') return { kind: 'reconcile' as const, payment: same };
        throw unprocessable('PAYMENT_REFUSED', 'O pagamento desta tentativa foi recusado. Use uma nova chave para tentar de novo.');
      }
      if (tab.status !== 'open') throw conflict('TAB_CLOSED', 'Esta comanda já foi fechada.');
      await this.assertNoPaymentInFlight(tx, tabId);
      // Cobrança desfeita com estorno ainda pendente: o dinheiro do cliente está retido. Nova cobrança só depois do estorno.
      const unrefunded = await tx.tabPayment.findFirst({ where: { tabId, failureReason: 'refund_pending' }, select: { id: true } });
      if (unrefunded) throw conflict('TAB_REFUND_PENDING', 'Há um estorno pendente nesta comanda. Conclua o estorno (repetir estorno) antes de cobrar de novo.');
      await this.assertNoPendingOrderPayments(tx, tabId);
      const { balanceCents } = tabTotals(tab.orders);
      const method = dto.method ?? 'credit';
      if (balanceCents > 0) {
        if (method === 'pix') throw unprocessable('TAB_PAYMENT_METHOD_UNSUPPORTED', 'O fechamento da comanda aceita apenas cartão de crédito ou débito.');
        if (!this.gateway.available) throw new AppError(503, 'PAYMENT_UNAVAILABLE', 'O pagamento pelo app não está disponível no momento.');
        if (!dto.cardToken || !dto.paymentMethodId) throw unprocessable('CARD_REQUIRED', 'Informe os dados do cartão.');
      }
      const payment = await tx.tabPayment.create({
        data: { tabId, idempotencyKey: dto.idempotencyKey, method, amountCents: balanceCents, createdById: actorId },
      });
      return { kind: 'new' as const, payment };
    }, TRANSACTION);
  }

  private async charge(payment: TabPayment, dto: CloseTabRequest, email: string | null): Promise<TabPayment> {
    let result: GatewayPayment | null;
    try {
      result = await this.gateway.createPayment({
        reference: payment.id,
        idempotencyKey: `tab-payment-${payment.id}`,
        amountCents: payment.amountCents,
        description: 'Fechamento de comanda',
        method: payment.method,
        payerEmail: email ?? 'caixa@filafacil.local',
        expiresAt: new Date(Date.now() + 30 * 60_000),
        cardToken: dto.cardToken,
        paymentMethodId: dto.paymentMethodId,
      });
    } catch (error) {
      if (!(error instanceof GatewayError)) throw error;
      if (error.outcome === 'not_processed') {
        await this.prisma.tabPayment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'refused', failureReason: 'gateway_not_processed' } });
        throw gatewayFailure();
      }
      this.logger.warn(`Resultado incerto no fechamento ${payment.id}: ${error.message}`);
      result = await this.gateway.findByReference(payment.id).catch(() => null);
      if (!result) throw gatewayFailure(); // pendente: repetir com a mesma chave concilia
    }
    await this.settle(payment.id, result);
    return payment;
  }

  /** Repetição com a mesma chave de uma tentativa pendente: pergunta ao gateway; sem resposta, continua pendente. */
  private async reconcile(payment: TabPayment): Promise<TabPayment> {
    let found: GatewayPayment | null;
    try {
      found = await this.gateway.findByReference(payment.id);
    } catch {
      throw gatewayFailure();
    }
    if (!found) {
      if (Date.now() - payment.createdAt.getTime() < 20_000) throw conflict('TAB_PAYMENT_IN_PROGRESS', 'O fechamento está em andamento. Tente novamente em instantes.');
      throw gatewayFailure();
    }
    await this.settle(payment.id, found);
    return payment;
  }

  /**
   * Toma os locks `order:<id>` dos pedidos da comanda (ordem estável). O pagamento individual toma o mesmo lock antes
   * de conferir a cobrança da comanda, então fechar e pagar um pedido nunca passam um pelo outro.
   */
  private async lockTabOrders(tx: PrismaTx, tabId: string) {
    const orders = await tx.order.findMany({ where: { tabId, status: { not: 'cancelled' } }, select: { id: true }, orderBy: { id: 'asc' } });
    for (const order of orders) await lockResource(tx, `order:${order.id}`);
  }

  /** Pedido da comanda com Pix/cartão pendente: o fechamento espera, para nunca cobrar duas vezes. */
  private async assertNoPendingOrderPayments(tx: PrismaTx, tabId: string) {
    const pending = await tx.payment.findFirst({ where: { status: 'pending', OR: [{ pixExpiresAt: null }, { pixExpiresAt: { gt: new Date() } }], order: { tabId, status: { not: 'cancelled' } } }, select: { id: true } });
    if (pending) throw conflict('ORDER_HAS_PENDING_PAYMENT', 'Há pedido da comanda com pagamento em andamento. Aguarde a confirmação ou cancele o pagamento antes de fechar.');
  }

  /**
   * Tentativa pendente sem resposta há mais de 30 min não trava a comanda para sempre: pergunta ao gateway; se a
   * cobrança existe, aplica; se o gateway confirma que não existe, expira a tentativa; sem resposta, continua pendente.
   */
  private async resolveStale(establishmentId: string, tabId: string) {
    const stale = await this.prisma.tabPayment.findMany({
      where: { tabId, status: 'pending', createdAt: { lt: new Date(Date.now() - STALE_ATTEMPT_MS) }, tab: { establishmentId } },
    });
    for (const payment of stale) {
      let found: GatewayPayment | null;
      try {
        found = await this.gateway.findByReference(payment.id);
      } catch (error) {
        // Só o gateway fora do ar mantém a tentativa pendente; qualquer outro erro é bug e não pode ser engolido.
        if (error instanceof GatewayError) continue;
        throw error;
      }
      if (found) await this.settle(payment.id, found);
      else await this.prisma.tabPayment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'expired', failureReason: 'unconfirmed' } });
    }
  }

  /**
   * Aprovação tardia: tentativa que expirou por "não encontrada" (`unconfirmed`) mas que o gateway agora mostra aprovada.
   * A cobrança existe, então não é ignorada: se a comanda ainda está aberta e o valor bate, a tentativa volta a pendente
   * e é aplicada (fecha a comanda); se a comanda já fechou por outro pagamento ou o saldo mudou, o estorno é pedido
   * (com alerta `tab_refund_pending` quando não confirma). Só roda para tentativas dos últimos 7 dias.
   */
  private async reviveExpired(establishmentId: string, tabId: string) {
    const expired = await this.prisma.tabPayment.findMany({
      where: { tabId, status: 'expired', failureReason: 'unconfirmed', createdAt: { gt: new Date(Date.now() - 7 * 24 * 3600_000) }, tab: { establishmentId } },
    });
    for (const payment of expired) {
      let found: GatewayPayment | null;
      try {
        found = await this.gateway.findByReference(payment.id);
      } catch (error) {
        if (error instanceof GatewayError) continue;
        throw error;
      }
      if (found?.status !== 'approved') continue;
      let revived = 0;
      try {
        revived = (await this.prisma.tabPayment.updateMany({ where: { id: payment.id, status: 'expired' }, data: { status: 'pending', failureReason: null } })).count;
      } catch (error) {
        // Índice parcial: já há outra cobrança pendente/aprovada nesta comanda → esta é duplicada.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
      if (revived === 0) await this.refundLate(establishmentId, payment, found);
      else await this.settle(payment.id, found);
    }
  }

  private async refundLate(establishmentId: string, payment: TabPayment, found: GatewayPayment) {
    let refunded = false;
    try {
      await this.gateway.refundPayment(found.id, `tab-refund-${payment.id}`);
      refunded = true;
    } catch (error) {
      if (!(error instanceof GatewayError)) throw error;
    }
    await this.prisma.tabPayment.update({
      where: { id: payment.id },
      data: { status: 'cancelled', providerPaymentId: found.id, failureReason: refunded ? 'late_refunded' : 'refund_pending' },
    });
    if (!refunded) {
      await this.alerts.open(establishmentId, 'tab_refund_pending', payment.id, 'Cobrança aprovada tardiamente em tentativa expirada: estorno pendente.');
    }
  }

  /**
   * Cartão individual pendente sem resposta (sem `providerPaymentId`) há mais de 30 min não bloqueia o caixa para sempre:
   * se o gateway confirma que não há cobrança, a tentativa é encerrada; se há cobrança, o pedido continua bloqueado
   * (o cliente concilia pelo app); sem resposta do gateway, nada muda.
   */
  private async resolveStaleOrderPayments(establishmentId: string, tabId: string) {
    const stale = await this.prisma.payment.findMany({
      where: { status: 'pending', providerPaymentId: null, createdAt: { lt: new Date(Date.now() - STALE_ATTEMPT_MS) }, order: { tabId, establishmentId, status: { not: 'cancelled' } } },
      select: { id: true },
    });
    for (const payment of stale) {
      let found: GatewayPayment | null;
      try {
        found = await this.gateway.findByReference(payment.id);
      } catch (error) {
        if (error instanceof GatewayError) continue;
        throw error;
      }
      if (!found) await this.prisma.payment.updateMany({ where: { id: payment.id, status: 'pending', providerPaymentId: null }, data: { status: 'cancelled', failureReason: 'unconfirmed' } });
    }
  }

  /**
   * Repete o estorno pendente da comanda: cobranças desfeitas no fechamento (`refund_pending`) e pagamentos individuais
   * aprovados em duplicidade. A chamada ao gateway é idempotente (chave fixa) e fica fora de transação; o registro do
   * desfecho roda sob o lock da comanda. Só erro do gateway conta como "ainda pendente": qualquer outro erro sobe.
   */
  async retryRefunds(establishmentId: string, tabId: string): Promise<{ retried: number; stillPending: number }> {
    const closing = await this.prisma.tabPayment.findMany({ where: { tabId, status: 'cancelled', failureReason: 'refund_pending', providerPaymentId: { not: null }, tab: { establishmentId } } });
    const duplicates = await this.prisma.payment.findMany({
      where: { status: 'approved', refundRequestedAt: { not: null }, providerPaymentId: { not: null }, order: { tabId, establishmentId, tabSettledAt: { not: null } } },
    });
    const targets = [
      ...closing.map(payment => ({ kind: 'tab' as const, id: payment.id, providerId: payment.providerPaymentId as string, key: `tab-refund-${payment.id}` })),
      ...duplicates.map(payment => ({ kind: 'order' as const, id: payment.id, providerId: payment.providerPaymentId as string, key: `refund-${payment.id}` })),
    ];
    let stillPending = 0;
    for (const target of targets) {
      let refunded = false;
      try {
        await this.gateway.refundPayment(target.providerId, target.key);
      } catch (error) {
        if (!(error instanceof GatewayError)) throw error;
      }
      try {
        refunded = (await this.gateway.getPayment(target.providerId)).status === 'refunded';
      } catch (error) {
        if (!(error instanceof GatewayError)) throw error;
      }
      if (!refunded) {
        stillPending++;
        continue;
      }
      await this.prisma.$transaction(async tx => {
        await lockResource(tx, `tab:${tabId}`);
        if (target.kind === 'tab') await tx.tabPayment.updateMany({ where: { id: target.id, failureReason: 'refund_pending' }, data: { failureReason: 'balance_changed' } });
        else await tx.payment.updateMany({ where: { id: target.id, status: 'approved' }, data: { status: 'refunded', refundedAt: new Date() } });
      }, TRANSACTION);
      await this.alerts.resolve(establishmentId, 'tab_refund_pending', target.id);
    }
    return { retried: targets.length - stillPending, stillPending };
  }

  /**
   * Aplica o resultado do gateway (ou o saldo zero) sob lock: aprovado fecha a comanda e quita os pedidos
   * pendentes; recusado encerra só a tentativa. Valor aprovado diferente do saldo atual nunca fecha a comanda.
   */
  private async settle(paymentId: string, gatewayPayment: GatewayPayment | null) {
    const result = await this.prisma.$transaction(async tx => {
      const found = await tx.tabPayment.findUniqueOrThrow({ where: { id: paymentId } });
      await lockResource(tx, `tab:${found.tabId}`);
      const payment = await tx.tabPayment.findUniqueOrThrow({ where: { id: paymentId } });
      if (payment.status !== 'pending') return null;
      await this.lockTabOrders(tx, payment.tabId);
      const tab = await tx.tab.findUniqueOrThrow({ where: { id: payment.tabId }, include: TAB_INCLUDE });
      const status = gatewayPayment?.status ?? 'approved';
      if (status === 'refused' || status === 'cancelled' || status === 'expired') {
        await tx.tabPayment.update({ where: { id: paymentId }, data: { status: 'refused', failureReason: (gatewayPayment?.statusDetail ?? 'refused').slice(0, 120), providerPaymentId: gatewayPayment?.id } });
        return null;
      }
      if (status !== 'approved') return null;
      const totals = tabTotals(tab.orders);
      const individualPending = await tx.payment.findFirst({ where: { status: 'pending', OR: [{ pixExpiresAt: null }, { pixExpiresAt: { gt: new Date() } }], order: { tabId: tab.id, status: { not: 'cancelled' } } }, select: { id: true } });
      if (individualPending || tab.status !== 'open' || totals.balanceCents !== payment.amountCents || (gatewayPayment && gatewayPayment.amountCents !== payment.amountCents)) {
        // O saldo mudou durante a cobrança (ou o valor aprovado difere): não fecha; a cobrança é devolvida fora da transação.
        await tx.tabPayment.update({ where: { id: paymentId }, data: { status: 'cancelled', failureReason: 'balance_changed', providerPaymentId: gatewayPayment?.id } });
        return { mismatch: true as const, providerId: gatewayPayment?.id ?? null, tab };
      }
      const now = new Date();
      await tx.tabPayment.update({ where: { id: paymentId }, data: { status: 'approved', approvedAt: now, providerPaymentId: gatewayPayment?.id } });
      const toSettle = tab.orders.filter(order => order.status !== 'cancelled' && settlementOf(order) === 'on_tab');
      for (const order of toSettle) {
        await tx.order.update({ where: { id: order.id }, data: { tabSettledAt: now, paidAt: now } });
        if (order.status === 'delivered') await this.loyalty.earnForOrder(tx, order.id);
      }
      await tx.tab.update({
        where: { id: tab.id },
        data: { status: 'closed', closedAt: now, closedById: payment.createdById, closedTotalCents: totals.totalCents, closedPaidBeforeCents: totals.paidCents, closedChargedCents: payment.amountCents },
      });
      const owners = await tx.order.findMany({ where: { id: { in: toSettle.map(order => order.id) } }, select: { id: true, userId: true } });
      return { mismatch: false as const, tab, owners };
    }, TRANSACTION);
    if (!result) return;
    if (result.mismatch) {
      if (result.providerId) {
        try {
          await this.gateway.refundPayment(result.providerId, `tab-refund-${paymentId}`);
        } catch {
          // Estorno sem confirmação: fica registrado como pendente (repetível) e a equipe é avisada no painel.
          this.logger.error(`Fechamento ${paymentId}: o saldo mudou e o estorno falhou. Estorno pendente.`);
          await this.prisma.tabPayment.update({ where: { id: paymentId }, data: { failureReason: 'refund_pending' } });
          await this.alerts.open(result.tab.establishmentId, 'tab_refund_pending', paymentId, `Estorno pendente da comanda ${result.tab.label}: a cobrança foi desfeita mas o estorno não foi confirmado.`);
          throw conflict('TAB_REFUND_PENDING', 'O saldo da comanda mudou durante a cobrança e o estorno ainda está em verificação. A equipe foi avisada; não cobre de novo.');
        }
      }
      throw conflict('TAB_BALANCE_CHANGED', 'O saldo da comanda mudou durante a cobrança. A cobrança foi desfeita; confira o saldo e tente de novo.');
    }
    // Liquidada: libera a mesa/grupo pela regra de ocupação existente (e avisa a fila de espera).
    const tableIds = await this.scopeTableIds(result.tab);
    if (tableIds.length) await this.waitlist.releaseTables(result.tab.establishmentId, tableIds);
    this.realtime.tabsUpdated(result.tab.establishmentId, result.tab.id);
    for (const owner of result.owners) {
      this.realtime.orderUpdated(owner.userId, result.tab.establishmentId, owner.id);
      this.loyalty.notify(owner.userId);
    }
  }
}
