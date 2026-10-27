import { Injectable, Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { OrderDto, PaymentStatus } from '@filafacil/shared';
import { AppError, badRequest, conflict, forbidden, notFound, serviceUnavailable, unprocessable } from '../../common/http/app-error.js';
import { lockResource } from '../../database/advisory-lock.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import type { Payment } from '../../generated/prisma/client.js';
import type { AuthContext } from '../auth/auth.types.js';
import { GatewayError, PaymentGateway, type GatewayPayment, type WebhookRequest } from '../payments/payment-gateway.js';
import { SimulatedPaymentGateway } from '../payments/simulated-payment.gateway.js';
import { occupyForPayment } from '../tables/table-state.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { CreatePaymentDto } from './dto/orders.dto.js';
import { AlertsService } from '../kitchen/alerts.service.js';
import { OrderEffectsService } from './order-effects.service.js';
import { ORDER_INCLUDE, toOrderDto } from './order.mapper.js';
import { OrdersService } from './orders.service.js';

/** Validade do código Pix; depois disso o cliente gera outro. */
const PIX_TTL_MS = 30 * 60 * 1000;
/** Transações são curtas (só banco): o gateway nunca é chamado dentro delas. */
const TRANSACTION = { timeout: 10_000, maxWait: 10_000 };
/** Uma tentativa recém-criada pode ainda estar com a requisição ao gateway em andamento (timeout HTTP = 15 s). */
const GATEWAY_INFLIGHT_MS = 20_000;

/** Estados finais só mudam para os listados: aprovado pode ser estornado; os demais não voltam. */
const ALLOWED_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ['approved', 'refused', 'expired', 'cancelled', 'refunded'],
  approved: ['refunded'],
  refused: [],
  expired: [],
  cancelled: [],
  refunded: [],
};

const gatewayFailure = () => new AppError(502, 'PAYMENT_GATEWAY_ERROR', 'Não conseguimos falar com o provedor de pagamento. Tente novamente em instantes.');
const refundUncertain = () =>
  new AppError(502, 'REFUND_UNCERTAIN', 'O estorno ainda não foi confirmado pelo provedor. Ele fica registrado: tente de novo em instantes, sem risco de estornar duas vezes.');

type PaymentPlan =
  | { kind: 'reuse' }
  | { kind: 'already_paid' }
  | { kind: 'unresolved'; payment: Payment }
  | { kind: 'discard'; payment: Payment }
  | { kind: 'new' };

/**
 * Pagamento dos pedidos (ficha 04). Regras que guiam tudo aqui:
 *  1. o status só muda com o que o gateway informa (nunca com o que o cliente diz);
 *  2. a tentativa é gravada ANTES de falar com o gateway (id estável = referência externa = chave de
 *     idempotência) e as chamadas HTTP nunca ficam dentro de transação;
 *  3. resultado incerto (timeout, conexão perdida) não é erro nem sucesso: a tentativa fica pendente sem
 *     `providerPaymentId` e é conciliada pelo gateway; enquanto estiver incerta, não se abre outra cobrança;
 *  4. webhook, sincronização, criação e estorno passam por `apply`, serializado por pedido e idempotente.
 */
@Injectable()
export class OrderPaymentsService {
  private readonly logger = new Logger(OrderPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
    private readonly realtime: RealtimeService,
    private readonly orders: OrdersService,
    private readonly effects: OrderEffectsService,
    private readonly alerts: AlertsService,
  ) {}

  // ─── Cliente: pagar ───────────────────────────────────────────────────────

  async create(auth: AuthContext, orderId: string, dto: CreatePaymentDto): Promise<OrderDto> {
    if (!this.gateway.available) throw serviceUnavailable('PAYMENT_UNAVAILABLE', 'O pagamento pelo app não está disponível no momento.');
    if (dto.method !== 'pix' && (!dto.cardToken || !dto.paymentMethodId)) {
      throw badRequest('VALIDATION_FAILED', 'Dados inválidos.', [{ field: 'cardToken', message: 'Informe os dados do cartão.' }]);
    }

    const owned = await this.prisma.order.findFirst({ where: { id: orderId, userId: auth.userId }, select: { id: true } });
    if (!owned) throw notFound('Pedido não encontrado.');

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { email: true, emailVerifiedAt: true, phoneVerifiedAt: true },
    });
    // Ficha 65: conta sem contato verificado não paga — regra do servidor, não da tela.
    if (!user.emailVerifiedAt && !user.phoneVerifiedAt) {
      throw forbidden('CONTACT_NOT_VERIFIED', 'Confirme seu e-mail ou celular para pagar pelo app.');
    }
    if (!user.email) throw unprocessable('PAYER_EMAIL_REQUIRED', 'Cadastre um e-mail na sua conta para pagar pelo app.');

    // Cada volta reavalia o estado depois de conciliar/descartar a tentativa anterior.
    for (let round = 0; round < 3; round++) {
      const plan = await this.plan(orderId, dto);
      if (plan.kind === 'reuse') return this.orderDto(orderId);
      if (plan.kind === 'already_paid') throw conflict('ALREADY_PAID', 'Este pedido já foi pago.');
      if (plan.kind === 'unresolved') {
        // Uma tentativa anterior pode ter cobrado: só segue se o gateway esclarecer. Nunca abre outra cobrança no escuro.
        if (!(await this.reconcile(plan.payment))) return this.orderDto(orderId);
        const current = await this.orderDto(orderId);
        if (current.status !== 'received') return current; // a conciliação revelou que já foi pago
        continue;
      }
      if (plan.kind === 'discard') {
        await this.discardPending(plan.payment);
        continue;
      }
      await this.orders.assertPayable(orderId, dto.expectedTotalCents);
      const attempt = await this.openAttempt(orderId, dto);
      if (!attempt) continue;
      return this.charge(attempt, dto, user.email);
    }
    throw conflict('PAYMENT_IN_PROGRESS', 'Já existe um pagamento em andamento para este pedido.');
  }

  /** Decide o próximo passo olhando só o banco (transação curta, com lock do pedido). */
  private plan(orderId: string, dto: CreatePaymentDto): Promise<PaymentPlan> {
    return this.prisma.$transaction(async tx => {
      await lockResource(tx, `order:${orderId}`);
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: { orderBy: { attempt: 'desc' } } } });
      if (order.status !== 'received') throw conflict('ORDER_NOT_PAYABLE', 'Este pedido não está aguardando pagamento.');
      await this.assertNotSettledOnTab(tx, order);
      const open = order.payments.find(payment => payment.status === 'pending' || payment.status === 'approved');
      if (!open) return { kind: 'new' };
      if (open.status === 'approved') return { kind: 'already_paid' };
      if (!open.providerPaymentId) return { kind: 'unresolved', payment: open };
      // Mesmo Pix ainda válido: devolve o mesmo código em vez de gerar outra cobrança.
      if (dto.method === 'pix' && open.method === 'pix' && open.pixCopyPaste && open.pixExpiresAt && open.pixExpiresAt > new Date()) return { kind: 'reuse' };
      return { kind: 'discard', payment: open };
    }, TRANSACTION);
  }

  /**
   * Pedido quitado no fechamento da comanda nunca é pago de novo (ALREADY_PAID); com o fechamento em andamento,
   * o pagamento individual espera. Roda sob o lock `order:<id>` (o fechamento também o toma antes de conferir).
   */
  private async assertNotSettledOnTab(tx: PrismaTx, order: { tabId: string | null; tabSettledAt: Date | null }) {
    if (order.tabSettledAt) throw conflict('ALREADY_PAID', 'Este pedido já foi pago na comanda.');
    if (order.tabId && (await tx.tabPayment.findFirst({ where: { tabId: order.tabId, status: 'pending' }, select: { id: true } }))) {
      throw conflict('TAB_PAYMENT_IN_PROGRESS', 'A comanda deste pedido está sendo fechada.');
    }
  }

  /** Grava a tentativa (pendente, sem id do gateway) antes de qualquer chamada externa. Null = outra requisição chegou antes. */
  private openAttempt(orderId: string, dto: CreatePaymentDto) {
    return this.prisma.$transaction(async tx => {
      await lockResource(tx, `order:${orderId}`);
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: { orderBy: { attempt: 'desc' } } } });
      if (order.status !== 'received') throw conflict('ORDER_NOT_PAYABLE', 'Este pedido não está aguardando pagamento.');
      await this.assertNotSettledOnTab(tx, order);
      if (order.payments.some(payment => payment.status === 'pending' || payment.status === 'approved')) return null;
      return tx.payment.create({
        data: {
          orderId,
          attempt: (order.payments[0]?.attempt ?? 0) + 1,
          method: dto.method,
          amountCents: order.totalCents,
          // Validade planejada do Pix: fica gravada para reaproveitar o mesmo corpo se for preciso repetir.
          pixExpiresAt: dto.method === 'pix' ? new Date(Date.now() + PIX_TTL_MS) : null,
        },
        include: { order: { select: { number: true, userId: true, establishmentId: true } } },
      });
    }, TRANSACTION);
  }

  /**
   * Fala com o gateway FORA de transação. A chave de idempotência e a referência são o id da tentativa
   * (estáveis). O token do cartão só é usado aqui, uma vez: nenhuma repetição o reutiliza.
   */
  private async charge(
    payment: Payment & { order: { number: number; userId: string; establishmentId: string } },
    dto: CreatePaymentDto,
    payerEmail: string,
  ): Promise<OrderDto> {
    let result: GatewayPayment | null;
    try {
      result = await this.gateway.createPayment({
        reference: payment.id,
        idempotencyKey: `payment-${payment.id}`,
        amountCents: payment.amountCents,
        description: `Pedido #${payment.order.number}`,
        method: dto.method,
        payerEmail,
        expiresAt: payment.pixExpiresAt ?? new Date(Date.now() + PIX_TTL_MS),
        cardToken: dto.cardToken,
        paymentMethodId: dto.paymentMethodId,
      });
    } catch (error) {
      if (!(error instanceof GatewayError)) throw error;
      if (error.outcome === 'not_processed') {
        // O gateway recusou antes de cobrar: tentativa encerrada, o cliente pode tentar de novo.
        await this.failAttempt(payment.id, 'gateway_not_processed');
        throw gatewayFailure();
      }
      // Timeout/conexão perdida: pode ter cobrado. A tentativa continua gravada e pendente; tenta esclarecer já.
      this.logger.warn(`Resultado incerto no pagamento ${payment.id}: ${error.message}`);
      result = await this.findQuietly(payment.id);
    }
    if (result) await this.applyLocked(payment.id, result);
    return this.orderDto(payment.orderId);
  }

  private async findQuietly(reference: string) {
    try {
      return await this.gateway.findByReference(reference);
    } catch {
      return null;
    }
  }

  private async failAttempt(paymentId: string, reason: string) {
    await this.prisma.payment.updateMany({
      where: { id: paymentId, status: 'pending', providerPaymentId: null },
      data: { status: 'refused', failureReason: reason },
    });
  }

  /**
   * Antes de trocar de forma de pagamento, a cobrança pendente é cancelada no gateway (fora de transação).
   * Se o cancelamento falhar, a verdade vem do gateway: pode ter sido paga (ou seguir em andamento) e então
   * o novo pagamento é barrado.
   */
  private async discardPending(pending: Payment) {
    const providerId = pending.providerPaymentId as string;
    try {
      await this.gateway.cancelPayment(providerId);
    } catch (error) {
      if (!(error instanceof GatewayError)) throw error;
      const current = await this.callGateway(() => this.gateway.getPayment(providerId));
      await this.applyLocked(pending.id, current);
      if (current.status === 'approved') throw conflict('ALREADY_PAID', 'Este pedido já foi pago.');
      if (current.status === 'pending') throw conflict('PAYMENT_IN_PROGRESS', 'Já existe um pagamento em andamento para este pedido.');
      return;
    }
    await this.prisma.payment.updateMany({ where: { id: pending.id, status: 'pending' }, data: { status: 'cancelled' } });
  }

  private async callGateway<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof GatewayError) throw gatewayFailure();
      throw error;
    }
  }

  // ─── Conciliação (sincronização, webhook, estorno) ────────────────────────

  /**
   * Esclarece uma tentativa sem `providerPaymentId` (a resposta do gateway se perdeu). Devolve true quando
   * o estado ficou definido e false quando ainda é incerto.
   *  - O gateway tem a cobrança (busca por `external_reference`): aplica o estado dela.
   *  - O gateway confirma que não há cobrança: só o Pix é encerrado — o código nunca chegou ao cliente, então
   *    ninguém pode pagá-lo. Cartão fica incerto: pode ter sido cobrado e a busca ainda não refletir.
   *  - O gateway não responde: continua incerto.
   */
  private async reconcile(payment: Payment): Promise<boolean> {
    // Recém-criada: a requisição original pode ainda estar em andamento. Não mexer.
    if (Date.now() - payment.createdAt.getTime() < GATEWAY_INFLIGHT_MS) return false;
    let found: GatewayPayment | null;
    try {
      found = await this.gateway.findByReference(payment.id);
    } catch {
      return false;
    }
    if (found) {
      await this.applyLocked(payment.id, found);
      return true;
    }
    if (payment.method === 'pix') {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: 'pending', providerPaymentId: null },
        data: { status: 'cancelled', failureReason: 'unconfirmed' },
      });
      return true;
    }
    return false;
  }

  /**
   * Fallback do webhook: consulta o gateway sobre o pagamento pendente do pedido (ou o estorno pedido e
   * ainda não confirmado) e aplica o resultado. Pedido de outra pessoa responde 404.
   */
  async sync(userId: string, orderId: string): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { payments: { where: { OR: [{ status: 'pending' }, { status: 'approved', refundRequestedAt: { not: null } }] }, take: 1 } },
    });
    if (!order) throw notFound('Pedido não encontrado.');
    const payment = order.payments[0];
    if (payment && this.gateway.available) {
      if (payment.providerPaymentId) {
        const providerId = payment.providerPaymentId;
        await this.applyLocked(payment.id, await this.callGateway(() => this.gateway.getPayment(providerId)));
      } else {
        await this.reconcile(payment);
      }
    }
    return this.orderDto(orderId);
  }

  /**
   * Demonstração: o cliente dono do pedido "paga" o Pix simulado. Só existe com o gateway simulado (com outro
   * provider a rota responde 404). A aprovação nunca é gravada aqui: o simulador só marca a cobrança e quem muda
   * pagamento e pedido é o `apply()` de sempre (sync), com lock, conferência de valor e evento em tempo real.
   */
  async simulateConfirm(userId: string, orderId: string): Promise<OrderDto> {
    const gateway = this.gateway;
    if (!(gateway instanceof SimulatedPaymentGateway)) throw notFound('Recurso não encontrado.');
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { payments: { where: { status: 'pending', method: 'pix', providerPaymentId: { not: null } }, take: 1 } },
    });
    if (!order) throw notFound('Pedido não encontrado.');
    const payment = order.payments[0];
    if (!payment?.providerPaymentId) throw conflict('NO_PENDING_PIX', 'Este pedido não tem um Pix simulado pendente.');
    try {
      await gateway.confirmPix(payment.providerPaymentId);
    } catch (error) {
      if (error instanceof GatewayError) throw conflict('NO_PENDING_PIX', 'Este pedido não tem um Pix simulado pendente.');
      throw error;
    }
    return this.sync(userId, orderId);
  }

  /** Notificação do Mercado Pago: autentica a assinatura e confirma o estado consultando o gateway. */
  async handleWebhook(request: WebhookRequest): Promise<void> {
    if (!this.gateway.verifyWebhook(request)) throw new AppError(401, 'INVALID_SIGNATURE', 'Assinatura inválida.');
    if (!request.dataId) return;
    // O corpo da notificação não é confiável: o estado real vem de uma consulta ao gateway.
    const current = await this.callGateway(() => this.gateway.getPayment(request.dataId as string));
    // A referência vem do gateway e pode ser de outra integração: só vale se for um id nosso.
    const payment =
      current.externalReference && isUUID(current.externalReference)
        ? await this.prisma.payment.findUnique({ where: { id: current.externalReference } })
        : await this.prisma.payment.findUnique({ where: { providerPaymentId: current.id } });
    if (!payment) {
      // A tentativa é gravada antes da cobrança, então um pagamento sem linha nossa não é deste app.
      this.logger.warn(`Webhook de pagamento ${current.id} sem registro local (referência ${current.externalReference ?? '—'}); ignorado.`);
      return;
    }
    await this.applyLocked(payment.id, current);
  }

  /**
   * Estorno pela equipe autorizada (`orders.refund`). O pedido de estorno é gravado antes de chamar o
   * gateway (`refundRequestedAt`) e a chave de idempotência é fixa: repetir nunca estorna duas vezes.
   * Qualquer resposta (sucesso, erro, "já estornado") termina consultando o gateway — a verdade vem dele.
   */
  async refund(establishmentId: string, orderId: string, options: { customer?: boolean } = {}): Promise<void> {
    if (!this.gateway.available) throw serviceUnavailable('PAYMENT_UNAVAILABLE', 'O pagamento pelo app não está disponível no momento.');
    const target = await this.prisma.$transaction(async tx => {
      await lockResource(tx, `order:${orderId}`);
      const order = await tx.order.findFirst({
        where: { id: orderId, establishmentId },
        select: { status: true, payments: { where: { status: 'approved' }, take: 1 } },
      });
      if (!order) throw notFound('Pedido não encontrado.');
      const payment = order.payments[0];
      // Estorno já pedido e não confirmado pode ser repetido mesmo se o pedido avançou de etapa.
      const refundable = options.customer
        ? order.status === 'paid' || Boolean(payment?.refundRequestedAt)
        : order.status === 'paid' || order.status === 'preparing' || (payment?.refundRequestedAt && order.status === 'ready');
      if (!payment?.providerPaymentId || !refundable) {
        throw unprocessable('ORDER_NOT_REFUNDABLE', 'Só é possível estornar pedidos pagos que ainda não ficaram prontos.');
      }
      await tx.payment.update({ where: { id: payment.id }, data: { refundRequestedAt: payment.refundRequestedAt ?? new Date() } });
      return { paymentId: payment.id, providerId: payment.providerPaymentId };
    }, TRANSACTION);

    let refundFailed = false;
    try {
      await this.gateway.refundPayment(target.providerId, `refund-${target.paymentId}`);
    } catch (error) {
      if (!(error instanceof GatewayError)) throw error;
      refundFailed = true;
      this.logger.warn(`Estorno do pagamento ${target.paymentId} sem confirmação: ${error.message}`);
    }
    let current: GatewayPayment | null = null;
    try {
      current = await this.gateway.getPayment(target.providerId);
    } catch {
      // sem resposta: o estorno continua registrado como pedido e é conciliado depois (sync, webhook ou nova tentativa)
    }
    if (current) await this.applyLocked(target.paymentId, current);
    if (current?.status === 'refunded') return; // inclui "já estornado" respondido pelo gateway
    if (refundFailed || !current) throw refundUncertain();
    // O gateway aceitou mas ainda não reflete o estorno: o webhook ou a próxima consulta fecham o estado.
  }

  // ─── Cancelamento (ficha 10) ──────────────────────────────────────────────

  /**
   * Cancela o pedido. Cliente: só antes do preparo (`received`/`paid`). Equipe: pedido sem cobrança com
   * `orders.manage`; depois do pagamento/preparo exige `orders.refund`. Pago ⇒ estorno automático pelo fluxo
   * existente (o pedido só fica `cancelled` quando o gateway confirma o estorno; estorno incerto é repetível e
   * o pedido segue pago). Estoque já consumido no preparo não é revertido; pontos são devolvidos/revertidos.
   */
  async cancel(actor: { customerId: string } | { establishmentId: string; actorId: string; canRefund: boolean }, orderId: string): Promise<void> {
    const customer = 'customerId' in actor;
    const order = await this.prisma.order.findFirst({
      where: customer ? { id: orderId, userId: actor.customerId } : { id: orderId, establishmentId: actor.establishmentId },
      select: { id: true, status: true, establishmentId: true, tabSettledAt: true, payments: { orderBy: { attempt: 'desc' }, take: 1 } },
    });
    if (!order) throw notFound('Pedido não encontrado.');
    const payment = order.payments[0];
    const notCancellable = () => conflict('ORDER_NOT_CANCELLABLE', customer ? 'Este pedido não pode mais ser cancelado pelo app. Procure o atendimento.' : 'Este pedido não pode ser cancelado.');
    if (order.status === 'delivered' || order.status === 'cancelled') throw notCancellable();
    if (order.tabSettledAt) {
      throw conflict('ORDER_SETTLED_ON_TAB', 'Este pedido já foi pago no fechamento da comanda e não pode ser cancelado pelo sistema. Procure o atendimento para o ajuste.');
    }
    if (customer && (order.status === 'preparing' || order.status === 'ready')) throw notCancellable();
    if (!customer && order.status !== 'received' && !actor.canRefund) {
      throw forbidden('MISSING_PERMISSION', 'Seu usuário não tem permissão para cancelar pedidos já pagos ou em preparo.');
    }

    if (payment?.status === 'approved') {
      // Pago: estorno automático (a atualização para `cancelled` vem do gateway, via `apply`).
      await this.refund(order.establishmentId, order.id, { customer });
      if (!customer) await this.prisma.order.updateMany({ where: { id: order.id, status: 'cancelled', cancelledById: null }, data: { cancelledById: actor.actorId } });
      return;
    }
    if (payment?.status === 'pending') {
      // Cobrança aberta (Pix): cancela no gateway antes; resultado incerto ou já pago interrompe.
      if (!this.gateway.available) throw serviceUnavailable('PAYMENT_UNAVAILABLE', 'O pagamento pelo app não está disponível no momento.');
      if (payment.providerPaymentId) await this.discardPending(payment);
      else if (!(await this.reconcile(payment))) throw conflict('PAYMENT_UNCERTAIN', 'Há um pagamento em confirmação. Tente cancelar novamente em instantes.');
    }
    const result = await this.prisma.$transaction(async tx => {
      await lockResource(tx, `order:${order.id}`);
      const current = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, userId: true, tabSettledAt: true, payments: { where: { status: { in: ['pending', 'approved'] } }, select: { id: true }, take: 1 } } });
      if (current.tabSettledAt) throw conflict('ORDER_SETTLED_ON_TAB', 'Este pedido já foi pago no fechamento da comanda.');
      if (current.payments.length > 0) throw conflict('PAYMENT_IN_PROGRESS', 'Há um pagamento em andamento neste pedido.');
      if (current.status === 'delivered' || current.status === 'cancelled' || (customer && current.status !== 'received')) throw notCancellable();
      const changed = await tx.order.updateMany({
        where: { id: order.id, status: current.status },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: customer ? null : actor.actorId, cancelReason: customer ? 'customer' : 'staff' },
      });
      if (changed.count === 0) throw conflict('ORDER_STATUS_CHANGED', 'O pedido foi atualizado por outra pessoa. Recarregue.');
      await this.effects.onCancelled(tx, order.id);
      return current;
    }, TRANSACTION);
    this.realtime.orderUpdated(result.userId, order.establishmentId, order.id);
  }

  /** Aplica o estado do gateway sob lock do pedido e avisa os interessados depois do commit. */
  private async applyLocked(paymentId: string, gatewayPayment: GatewayPayment) {
    const result = await this.prisma.$transaction(async tx => {
      const found = await tx.payment.findUnique({ where: { id: paymentId }, select: { orderId: true } });
      if (!found) return null;
      await lockResource(tx, `order:${found.orderId}`);
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: { select: { userId: true, establishmentId: true } } } });
      const changed = await this.apply(tx, payment, gatewayPayment);
      return changed ? { orderId: payment.orderId, duplicate: changed === 'duplicate', ...payment.order } : null;
    }, TRANSACTION);
    if (result) this.realtime.orderUpdated(result.userId, result.establishmentId, result.orderId);
    if (result?.duplicate) await this.refundDuplicate(paymentId, result.establishmentId);
  }

  /**
   * Pagamento individual aprovado DEPOIS de o pedido ser quitado no fechamento da comanda (ex.: Pix aprovado após o
   * prazo local): é cobrança em duplicidade. O estorno é pedido na hora (idempotente); sem confirmação, o estorno fica
   * registrado (`refundRequestedAt`) e um alerta não dispensável avisa a equipe; `tabs/:id/refunds/retry` repete.
   */
  private async refundDuplicate(paymentId: string, establishmentId: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const providerId = payment.providerPaymentId;
    let refunded = false;
    if (providerId) {
      try {
        await this.gateway.refundPayment(providerId, `refund-${paymentId}`);
      } catch (error) {
        if (!(error instanceof GatewayError)) throw error;
      }
      try {
        const current = await this.gateway.getPayment(providerId);
        if (current.status === 'refunded') {
          await this.applyLocked(paymentId, current);
          refunded = true;
        }
      } catch (error) {
        if (!(error instanceof GatewayError)) throw error;
      }
    }
    if (!refunded) {
      this.logger.error(`Pagamento ${paymentId} aprovado em pedido já quitado na comanda; estorno pendente.`);
      await this.alerts.open(establishmentId, 'tab_refund_pending', paymentId, 'Pagamento em duplicidade (pedido já quitado na comanda): estorno pendente. Repita o estorno na comanda.');
    }
  }

  /**
   * Única porta de entrada para mudar pagamento/pedido a partir do gateway. Idempotente: o mesmo
   * estado aplicado duas vezes não faz nada. Precisa rodar sob `lockResource(order:<id>)`.
   * Devolve `true` quando algo mudou.
   */
  private async apply(tx: PrismaTx, payment: Payment, gatewayPayment: GatewayPayment): Promise<boolean | 'duplicate'> {
    if (gatewayPayment.externalReference && gatewayPayment.externalReference !== payment.id) {
      this.logger.error(`Pagamento ${gatewayPayment.id} não pertence a ${payment.id}; ignorado.`);
      return false;
    }
    if (payment.providerPaymentId && payment.providerPaymentId !== gatewayPayment.id) {
      this.logger.error(`Pagamento ${payment.id} já ligado a ${payment.providerPaymentId}; ${gatewayPayment.id} ignorado.`);
      return false;
    }

    const data: Parameters<typeof tx.payment.update>[0]['data'] = {};
    if (!payment.providerPaymentId) data.providerPaymentId = gatewayPayment.id;
    if (payment.method === 'pix' && gatewayPayment.pix && !payment.pixCopyPaste) {
      data.pixCopyPaste = gatewayPayment.pix.copyPaste;
      data.pixQrBase64 = gatewayPayment.pix.qrBase64;
      data.pixExpiresAt = gatewayPayment.pix.expiresAt ?? payment.pixExpiresAt;
    }

    const next = gatewayPayment.status;
    let statusChanged = false;
    if (next !== payment.status) {
      if (!ALLOWED_TRANSITIONS[payment.status].includes(next)) {
        // Ex.: cobrança que cancelamos e o gateway acabou aprovando. Exige conferência manual.
        this.logger.error(`Transição ${payment.status} → ${next} ignorada no pagamento ${payment.id} (gateway ${gatewayPayment.id}). Conferir estorno manual.`);
      } else if (next === 'approved' && gatewayPayment.amountCents !== payment.amountCents) {
        this.logger.error(`Valor aprovado ${gatewayPayment.amountCents} difere do pedido (${payment.amountCents}) no pagamento ${payment.id}. Não confirmado.`);
      } else {
        statusChanged = true;
        data.status = next;
        if (next === 'approved') data.approvedAt = new Date();
        if (next === 'refunded') data.refundedAt = new Date();
        if (next === 'refused') data.failureReason = (gatewayPayment.statusDetail ?? 'refused').slice(0, 120);
      }
    }
    if (Object.keys(data).length === 0) return false;
    await tx.payment.update({ where: { id: payment.id }, data });

    if (statusChanged && data.status === 'approved') {
      const settled = await tx.order.findUnique({ where: { id: payment.orderId }, select: { tabSettledAt: true } });
      if (settled?.tabSettledAt) {
        // Pedido já pago no fechamento da comanda: este pagamento é duplicado. O pedido não muda; o estorno é pedido já.
        await tx.payment.update({ where: { id: payment.id }, data: { refundRequestedAt: new Date() } });
        return 'duplicate';
      }
      await tx.order.updateMany({ where: { id: payment.orderId, status: 'received' }, data: { status: 'paid', paidAt: data.approvedAt as Date } });
      // Ficha 16: pagamento aprovado ocupa a mesa do pedido (se estava livre) e inicia a conta dela.
      const order = await tx.order.findUnique({ where: { id: payment.orderId }, select: { tableId: true, establishmentId: true } });
      await occupyForPayment(tx, order?.tableId ?? null, order?.establishmentId ?? '', data.approvedAt as Date);
    }
    if (statusChanged && data.status === 'refunded') {
      const cancelled = await tx.order.updateMany({
        where: { id: payment.orderId, tabSettledAt: null, status: { in: ['received', 'paid', 'preparing', 'ready'] } },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'refunded' },
      });
      if (cancelled.count > 0) await this.effects.onCancelled(tx, payment.orderId);
    }
    return true;
  }

  private async orderDto(orderId: string): Promise<OrderDto> {
    return toOrderDto(await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_INCLUDE }));
  }
}
