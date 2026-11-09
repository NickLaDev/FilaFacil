import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { discountForPoints, normalizeCouponCode, STAFF_ORDER_TRANSITIONS, type OrderDto, type OrderQueueDto, type OrderQueuePositionDto, type OrderStatus, type Page, type StaffOrderDto } from '@filafacil/shared';
import { conflict, forbidden, notFound, unprocessable } from '../../common/http/app-error.js';
import { pageArgs, toPage } from '../../common/pagination/page-query.dto.js';
import { bestPromotion, finalPriceCents } from '../../common/pricing.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { lockResource } from '../../database/advisory-lock.js';
import { EntitlementsService } from '../access/entitlements.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { RestaurantsService } from '../restaurants/restaurants.service.js';
import type { CreateOrderDto, QueueQueryDto, StaffOrdersQueryDto } from './dto/orders.dto.js';
import { BenefitsService } from '../benefits/benefits.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { OrderEffectsService } from './order-effects.service.js';
import { ageMinutes, estimateOf, ORDER_INCLUDE, toOrderDto, toStaffOrderDto, type OrderWithDetails } from './order.mapper.js';

/** Pedidos em andamento na cozinha: já pagos e ainda não entregues. */
const ACTIVE_STATUSES: OrderStatus[] = ['paid', 'preparing', 'ready'];
const MAX_NOTES_LENGTH = 200;
/** Pedido criado e não pago por mais tempo que isto não pode mais ser pago: o carrinho já está velho. */
const UNPAID_ORDER_TTL_MS = 30 * 60 * 1000;

const pickupCode = () => String(randomInt(1000, 10_000));

/** Criação, consulta e andamento dos pedidos (fichas 08, 02 e 09). Preço e disponibilidade são sempre do servidor. */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restaurants: RestaurantsService,
    private readonly entitlements: EntitlementsService,
    private readonly realtime: RealtimeService,
    private readonly effects: OrderEffectsService,
    private readonly loyalty: LoyaltyService,
    private readonly benefits: BenefitsService,
  ) {}

  // ─── Cliente ──────────────────────────────────────────────────────────────

  async create(auth: AuthContext, dto: CreateOrderDto): Promise<OrderDto> {
    if (!auth.permissions.has('orders.place')) throw forbidden('MISSING_PERMISSION', 'Sua conta não pode fazer pedidos.');

    // Reenvio da mesma tentativa de checkout (retry, duplo clique): devolve o pedido já criado.
    const existing = await this.findByRequestId(auth.userId, dto.clientRequestId);
    if (existing) return this.replay(existing, dto);

    const establishment = await this.prisma.establishment.findFirst({
      where: { id: dto.establishmentId, status: 'active' },
      include: { openingHours: { select: { weekday: true, opensAt: true, closesAt: true } } },
    });
    if (!establishment) throw notFound('Restaurante não encontrado.');
    if (!this.restaurants.orderingState(establishment, new Date()).acceptingOrders) {
      throw unprocessable('ESTABLISHMENT_NOT_ACCEPTING_ORDERS', 'Este restaurante não está aceitando pedidos agora.');
    }

    const table = dto.tableId
      ? await this.prisma.diningTable.findFirst({ where: { id: dto.tableId, establishmentId: establishment.id }, select: { id: true, label: true } })
      : null;
    if (dto.tableId && !table) throw unprocessable('INVALID_TABLE', 'Esta mesa não pertence ao restaurante do pedido.');

    const now = new Date();
    const lines = await this.priceLines(establishment.id, dto.items, now);
    const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
    const redeemPoints = dto.redeemPoints ?? 0;
    const cashbackUse = dto.useCashbackCents ?? 0;
    const couponCode = dto.couponCode?.trim() ? normalizeCouponCode(dto.couponCode) : null;
    // Pedido antigo não pago ainda segura pontos, cashback ou cupom: solta antes de conferir saldos e usos.
    if (redeemPoints > 0 || cashbackUse > 0 || couponCode) await this.loyalty.releaseExpired(auth.userId);
    const couponPreview = couponCode ? await this.benefits.resolveCoupon(this.prisma, { userId: auth.userId, establishmentId: establishment.id, code: couponCode, subtotalCents, now }) : null;
    const afterCoupon = subtotalCents - (couponPreview?.discountCents ?? 0);
    // O total que o cliente viu já vem líquido de cupom, pontos (ficha 14) e cashback (ficha 15).
    const expectedNet = afterCoupon - discountForPoints(redeemPoints) - cashbackUse;
    if (dto.expectedTotalCents !== undefined && dto.expectedTotalCents !== expectedNet) {
      throw conflict('PRICE_CHANGED', 'Os preços mudaram desde que você montou o pedido. Revise o carrinho.');
    }

    try {
      const created = await this.prisma.$transaction(async tx => {
        const order = await tx.order.create({
          data: {
            userId: auth.userId,
            establishmentId: establishment.id,
            tableId: table?.id,
            tableLabel: table?.label,
            clientRequestId: dto.clientRequestId,
            totalCents: subtotalCents,
            pickupCode: pickupCode(),
            items: { create: lines },
          },
        });
        let total = subtotalCents;
        let couponDiscountCents = 0;
        let couponId: string | null = null;
        if (couponCode) {
          const redeemed = await this.benefits.redeemCoupon(tx, { userId: auth.userId, orderId: order.id, establishmentId: establishment.id, code: couponCode, subtotalCents });
          if (redeemed.discountCents !== (couponPreview?.discountCents ?? 0)) throw conflict('PRICE_CHANGED', 'O desconto do cupom mudou. Revise o carrinho.');
          couponDiscountCents = redeemed.discountCents;
          couponId = redeemed.coupon.id;
          total -= couponDiscountCents;
        }
        let discountCents = 0;
        if (redeemPoints > 0) {
          discountCents = await this.loyalty.reserveRedeem(tx, auth.userId, order.id, redeemPoints, total);
          total -= discountCents;
        }
        if (cashbackUse > 0) {
          await this.benefits.reserveCashback(tx, auth.userId, order.id, cashbackUse, total);
          total -= cashbackUse;
        }
        // Cashback a ganhar: congelado agora (regra vigente), creditado quando o pedido for entregue e pago.
        const earn = await this.benefits.cashbackForOrder(tx, { establishmentId: establishment.id, lines, subtotalCents, netCents: total, now });
        if (total !== subtotalCents || earn.cents > 0) {
          await tx.order.update({
            where: { id: order.id },
            data: {
              totalCents: total,
              discountCents,
              redeemedPoints: redeemPoints,
              cashbackUsedCents: cashbackUse,
              couponId,
              couponCode: couponId ? couponCode : null,
              couponDiscountCents,
              cashbackEarnCents: earn.cents,
              cashbackRuleId: earn.ruleId,
            },
          });
        }
        return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
      });
      this.realtime.orderUpdated(auth.userId, establishment.id, created.id);
      if (redeemPoints > 0) this.loyalty.notify(auth.userId);
      if (cashbackUse > 0) this.realtime.cashbackUpdated(auth.userId);
      return toOrderDto(created);
    } catch (error) {
      // Duas requisições simultâneas com o mesmo identificador: o índice único decide, a outra reaproveita.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.findByRequestId(auth.userId, dto.clientRequestId);
        if (raced) return this.replay(raced, dto);
      }
      throw error;
    }
  }

  /**
   * Reenvio do mesmo identificador de checkout: só devolve o pedido existente se o conteúdo for o mesmo.
   * Carrinho diferente com o identificador antigo nunca é "colado" num pedido de outros itens ou total.
   */
  private replay(existing: OrderWithDetails, dto: CreateOrderDto): OrderDto {
    const signature = (items: { menuItemId: string; quantity: number; notes?: string | null }[]) =>
      items
        .map(item => `${item.menuItemId}|${item.notes ?? ''}|${item.quantity}`)
        .sort()
        .join(';');
    if (
      existing.establishmentId !== dto.establishmentId ||
      (existing.tableId ?? null) !== (dto.tableId ?? null) ||
      existing.redeemedPoints !== (dto.redeemPoints ?? 0) ||
      existing.cashbackUsedCents !== (dto.useCashbackCents ?? 0) ||
      (existing.couponCode ?? '') !== (dto.couponCode?.trim() ? normalizeCouponCode(dto.couponCode) : '') ||
      signature(existing.items) !== signature(dto.items.map(item => ({ ...item, notes: (item.notes ?? '').slice(0, MAX_NOTES_LENGTH) })))
    ) {
      throw conflict('ORDER_CONTENT_CHANGED', 'O carrinho mudou desde o último pedido. Revise o carrinho e confirme de novo.');
    }
    if (dto.expectedTotalCents !== undefined && dto.expectedTotalCents !== existing.totalCents) {
      throw conflict('PRICE_CHANGED', 'Os preços mudaram desde que você montou o pedido. Revise o carrinho.');
    }
    return toOrderDto(existing);
  }

  /** Itens disponíveis do estabelecimento com o preço vigente (promoção incluída), na ordem recebida. */
  private async priceLines(establishmentId: string, items: { menuItemId: string; quantity: number; notes?: string | null }[], now: Date) {
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: [...new Set(items.map(item => item.menuItemId))] }, establishmentId, deletedAt: null },
      select: {
        id: true,
        name: true,
        priceCents: true,
        available: true,
        stationId: true,
        promotionItems: {
          where: { promotion: { startsAt: { lte: now }, endsAt: { gte: now } } },
          select: { promotion: { select: { discountPercent: true } } },
        },
      },
    });
    const byId = new Map(menuItems.map(item => [item.id, item]));
    const unavailable = items.filter(line => !byId.get(line.menuItemId)?.available);
    if (unavailable.length) {
      throw unprocessable(
        'ITEM_UNAVAILABLE',
        'Algum item do pedido não está mais disponível. Revise o carrinho.',
        unavailable.map(line => ({ field: line.menuItemId, message: 'Item indisponível.' })),
      );
    }
    const promotionsEnabled = (await this.entitlements.featuresFor(establishmentId)).has('promotions');
    return items.map(line => {
      const item = byId.get(line.menuItemId) as NonNullable<ReturnType<typeof byId.get>>;
      const promotion = promotionsEnabled ? bestPromotion(item.promotionItems.map(link => link.promotion)) : null;
      return {
        menuItemId: item.id,
        name: item.name,
        unitPriceCents: finalPriceCents(item.priceCents, promotion),
        quantity: line.quantity,
        notes: (line.notes ?? '').slice(0, MAX_NOTES_LENGTH),
        stationId: item.stationId,
      };
    });
  }

  /**
   * Antes de abrir uma NOVA cobrança: o pedido ainda vale? (não expirou, a casa aceita pedidos, itens e preços
   * são os da criação, e o total é o que o cliente viu). Pedidos já pagos ou com cobrança em andamento não
   * passam por aqui, então nada que já foi aceito é cancelado por mudança de estado da casa.
   */
  async assertPayable(orderId: string, expectedTotalCents?: number) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true, establishment: { include: { openingHours: { select: { weekday: true, opensAt: true, closesAt: true } } } } },
    });
    if (order.tabSettledAt) throw conflict('ALREADY_PAID', 'Este pedido já foi pago na comanda.');
    if (Date.now() - order.createdAt.getTime() > UNPAID_ORDER_TTL_MS) {
      throw conflict('ORDER_EXPIRED', 'Este pedido expirou sem pagamento. Revise o carrinho e confirme de novo.');
    }
    if (expectedTotalCents !== undefined && expectedTotalCents !== order.totalCents) {
      throw conflict('ORDER_TOTAL_CHANGED', 'O valor do pedido mudou. Revise o carrinho e confirme de novo.');
    }
    if (order.establishment.status !== 'active' || !this.restaurants.orderingState(order.establishment, new Date()).acceptingOrders) {
      throw unprocessable('ESTABLISHMENT_NOT_ACCEPTING_ORDERS', 'Este restaurante não está aceitando pedidos agora.');
    }
    const current = await this.priceLines(order.establishmentId, order.items, new Date());
    if (current.some((line, index) => line.unitPriceCents !== order.items[index]?.unitPriceCents)) {
      throw conflict('PRICE_CHANGED', 'Os preços mudaram desde que você montou o pedido. Revise o carrinho.');
    }
  }

  private findByRequestId(userId: string, clientRequestId: string) {
    return this.prisma.order.findUnique({ where: { userId_clientRequestId: { userId, clientRequestId } }, include: ORDER_INCLUDE });
  }

  async listMine(userId: string, query: { page: number; pageSize: number }): Promise<Page<OrderDto>> {
    const where = { userId };
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, include: ORDER_INCLUDE, ...pageArgs(query) }),
      this.prisma.order.count({ where }),
    ]);
    return toPage(orders.map(toOrderDto), total, query);
  }

  /** Pedido de outra pessoa responde 404, como os demais recursos com dono. */
  async getMine(userId: string, orderId: string): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId }, include: ORDER_INCLUDE });
    if (!order) throw notFound('Pedido não encontrado.');
    return toOrderDto(order);
  }

  /**
   * Ficha 51: posição do pedido na fila FIFO da casa (pagos, em preparo e os da comanda) e tempo restante
   * (estimativa − tempo desde o pagamento). O app recalcula ao receber `order.updated`/`queue.updated` e por polling.
   */
  async queuePosition(userId: string, orderId: string, now = new Date()): Promise<OrderQueuePositionDto> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true, number: true, status: true, tabId: true, paidAt: true, createdAt: true, establishmentId: true, estimatedMinutesOverride: true, establishment: { select: { averageWaitMinutes: true } } },
    });
    if (!order) throw notFound('Pedido não encontrado.');
    const estimatedMinutes = estimateOf(order);
    const age = ageMinutes(order, now);
    const inQueue = order.status === 'paid' || order.status === 'preparing' || (order.status === 'received' && order.tabId !== null);
    if (order.status === 'ready') return { orderId, state: 'ready', position: null, ordersAhead: 0, estimatedMinutes: null, remainingMinutes: null, late: false };
    if (order.status === 'delivered' || order.status === 'cancelled') return { orderId, state: 'done', position: null, ordersAhead: 0, estimatedMinutes: null, remainingMinutes: null, late: false };
    if (!inQueue) return { orderId, state: 'waiting', position: null, ordersAhead: 0, estimatedMinutes, remainingMinutes: Math.max(0, estimatedMinutes - age), late: false };

    const mine = (order.paidAt ?? order.createdAt).getTime();
    const others = await this.prisma.order.findMany({
      where: { establishmentId: order.establishmentId, id: { not: order.id }, OR: [{ status: { in: ['paid', 'preparing'] } }, { status: 'received', tabId: { not: null } }] },
      select: { number: true, paidAt: true, createdAt: true },
    });
    const ahead = others.filter(other => {
      const time = (other.paidAt ?? other.createdAt).getTime();
      return time < mine || (time === mine && other.number < order.number);
    }).length;
    return {
      orderId,
      state: order.status === 'preparing' ? 'preparing' : 'waiting',
      position: ahead + 1,
      ordersAhead: ahead,
      estimatedMinutes,
      remainingMinutes: Math.max(0, estimatedMinutes - age),
      late: age > estimatedMinutes,
    };
  }

  // ─── Equipe ───────────────────────────────────────────────────────────────

  async listForStaff(establishmentId: string, query: StaffOrdersQueryDto): Promise<Page<StaffOrderDto>> {
    const where = { establishmentId, status: query.status ? query.status : { in: ACTIVE_STATUSES } };
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        include: { ...ORDER_INCLUDE, user: { select: { name: true } } },
        ...pageArgs(query),
      }),
      this.prisma.order.count({ where }),
    ]);
    return toPage(orders.map(order => toStaffOrderDto(order)), total, query);
  }

  /**
   * Fila FIFO (ficha 23): pedidos pagos, em preparo e prontos, mais os atribuídos a comanda (pagamento posterior),
   * do mais antigo ao mais novo (desde o pagamento). Filtro opcional por status e por estação (ficha 24).
   */
  async queue(establishmentId: string, query: QueueQueryDto, now = new Date()): Promise<OrderQueueDto> {
    const rows = await this.prisma.order.findMany({
      where: {
        establishmentId,
        OR: [{ status: { in: ACTIVE_STATUSES } }, { status: 'received', tabId: { not: null } }],
      },
      include: { ...ORDER_INCLUDE, user: { select: { name: true } } },
    });
    const sorted = rows.sort((a, b) => (a.paidAt ?? a.createdAt).getTime() - (b.paidAt ?? b.createdAt).getTime() || a.number - b.number);
    const station = query.stationId;
    const filtered = sorted
      .filter(order => !query.status || order.status === query.status)
      .map(order => (station ? { ...order, items: order.items.filter(item => (station === 'general' ? item.stationId === null : item.stationId === station)) } : order))
      .filter(order => order.items.length > 0);
    const items = filtered.map((order, index) => ({ ...toStaffOrderDto(order, now), queuePosition: index + 1 }));
    const counts = { received: 0, paid: 0, preparing: 0, ready: 0 };
    for (const order of items) if (order.status in counts) counts[order.status as keyof typeof counts]++;
    return { items, counts, lateCount: items.filter(order => order.late).length };
  }

  /** Só avança um passo por vez (pago → preparo → pronto → entregue); pedido não pago nunca entra na cozinha. */
  async advanceStatus(establishmentId: string, orderId: string, status: OrderStatus): Promise<StaffOrderDto> {
    // Mesmo lock do estorno (`order:<id>`): avançar e estornar ao mesmo tempo nunca deixam o pedido entregue e estornado.
    const order = await this.prisma.$transaction(async tx => {
      await lockResource(tx, `order:${orderId}`);
      const current = await tx.order.findFirst({
        where: { id: orderId, establishmentId },
        select: {
          id: true,
          userId: true,
          status: true,
          tabId: true,
          items: { select: { id: true, stationId: true, readyAt: true } },
          payments: { where: { status: 'approved', refundRequestedAt: { not: null } }, select: { id: true }, take: 1 },
        },
      });
      if (!current) throw notFound('Pedido não encontrado.');
      // Pedido na comanda (pagamento posterior) pode ir para o preparo sem estar pago; sem comanda, nunca.
      const expected = STAFF_ORDER_TRANSITIONS[current.status] ?? (current.status === 'received' && current.tabId ? 'preparing' : undefined);
      if (expected !== status) {
        throw unprocessable('INVALID_STATUS_TRANSITION', 'Este pedido não pode ir para esse status agora.');
      }
      if (current.payments.length > 0) throw conflict('REFUND_IN_PROGRESS', 'Há um estorno em andamento neste pedido. Conclua o estorno antes de avançar.');
      if (status === 'ready' && current.items.some(item => item.stationId && !item.readyAt)) {
        throw conflict('STATIONS_PENDING', 'Ainda há estações com itens em preparo. Conclua cada estação.');
      }
      await this.transition(tx, current, status);
      return current;
    });
    this.realtime.orderUpdated(order.userId, establishmentId, order.id);
    if (status === 'preparing') await this.effects.afterPreparing(establishmentId, order.id);
    if (status === 'ready') await this.effects.afterReady({ id: order.id, userId: order.userId, establishmentId });
    if (status === 'delivered') this.effects.afterDelivered({ id: order.id, userId: order.userId, establishmentId });
    return this.getForStaff(establishmentId, order.id);
  }

  /** Aplica o novo status com carimbo de tempo e efeitos transacionais (sob o lock do pedido). */
  private async transition(tx: PrismaTx, current: { id: string; status: OrderStatus }, status: OrderStatus) {
    const now = new Date();
    const stamp = { preparing: { preparingAt: now }, ready: { readyAt: now }, delivered: { deliveredAt: now } } as Partial<Record<OrderStatus, Prisma.OrderUpdateManyMutationInput>>;
    // Atualização condicional: duas pessoas avançando ao mesmo tempo não pulam etapas.
    const changed = await tx.order.updateMany({ where: { id: current.id, status: current.status }, data: { status, ...stamp[status] } });
    if (changed.count === 0) throw conflict('ORDER_STATUS_CHANGED', 'O pedido foi atualizado por outra pessoa. Recarregue.');
    if (status === 'ready') await tx.orderItem.updateMany({ where: { orderId: current.id, readyAt: null }, data: { readyAt: now } });
    if (status === 'preparing') await this.effects.onPreparing(tx, current.id);
    if (status === 'delivered') await this.effects.onDelivered(tx, current.id);
  }

  /**
   * Estação concluiu seus itens (ficha 24). O pedido só vira `ready` quando todas as estações terminaram
   * (a última dispara o `ready` automaticamente, com aviso ao cliente). `stationId` null = "Geral".
   */
  async markStationReady(establishmentId: string, orderId: string, stationId: string | null): Promise<StaffOrderDto> {
    const result = await this.prisma.$transaction(async tx => {
      await lockResource(tx, `order:${orderId}`);
      const current = await tx.order.findFirst({
        where: { id: orderId, establishmentId },
        select: { id: true, userId: true, status: true, items: { select: { id: true, stationId: true, readyAt: true } } },
      });
      if (!current) throw notFound('Pedido não encontrado.');
      if (current.status !== 'preparing') throw unprocessable('INVALID_STATUS_TRANSITION', 'Só é possível concluir estações de um pedido em preparo.');
      const mine = current.items.filter(item => (item.stationId ?? null) === stationId);
      if (mine.length === 0) throw unprocessable('NO_ITEMS_FOR_STATION', 'Esta estação não tem itens neste pedido.');
      const now = new Date();
      await tx.orderItem.updateMany({ where: { id: { in: mine.map(item => item.id) }, readyAt: null }, data: { readyAt: now } });
      const allReady = current.items.every(item => (item.stationId ?? null) === stationId || item.readyAt);
      if (allReady) await this.transition(tx, current, 'ready');
      return { ...current, becameReady: allReady };
    });
    this.realtime.orderUpdated(result.userId, establishmentId, result.id);
    if (result.becameReady) await this.effects.afterReady({ id: result.id, userId: result.userId, establishmentId });
    return this.getForStaff(establishmentId, result.id);
  }

  /** Ficha 63: o gestor define o tempo estimado do pedido (1–240 min); o cliente passa a ver o valor ajustado. */
  async adjustEstimate(establishmentId: string, orderId: string, minutes: number, actorId: string): Promise<StaffOrderDto> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, establishmentId }, select: { id: true, userId: true, status: true } });
    if (!order) throw notFound('Pedido não encontrado.');
    if (order.status === 'delivered' || order.status === 'cancelled') throw unprocessable('ORDER_CLOSED', 'Este pedido já foi encerrado.');
    await this.prisma.order.update({ where: { id: orderId }, data: { estimatedMinutesOverride: minutes, estimateAdjustedAt: new Date(), estimateAdjustedById: actorId } });
    this.realtime.orderUpdated(order.userId, establishmentId, order.id);
    return this.getForStaff(establishmentId, order.id);
  }

  async getForStaff(establishmentId: string, orderId: string): Promise<StaffOrderDto> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, establishmentId },
      include: { ...ORDER_INCLUDE, user: { select: { name: true } } },
    });
    if (!order) throw notFound('Pedido não encontrado.');
    return toStaffOrderDto(order);
  }
}
