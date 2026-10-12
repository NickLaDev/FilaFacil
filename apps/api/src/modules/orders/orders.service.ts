import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { STAFF_ORDER_TRANSITIONS, type OrderDto, type OrderStatus, type Page, type StaffOrderDto } from '@filafacil/shared';
import { conflict, forbidden, notFound, unprocessable } from '../../common/http/app-error.js';
import { pageArgs, toPage } from '../../common/pagination/page-query.dto.js';
import { bestPromotion, finalPriceCents } from '../../common/pricing.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { lockResource } from '../../database/advisory-lock.js';
import { EntitlementsService } from '../access/entitlements.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { RestaurantsService } from '../restaurants/restaurants.service.js';
import type { CreateOrderDto, StaffOrdersQueryDto } from './dto/orders.dto.js';
import { ORDER_INCLUDE, toOrderDto, toStaffOrderDto, type OrderWithDetails } from './order.mapper.js';

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

    const lines = await this.priceLines(establishment.id, dto.items, new Date());
    const totalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
    if (dto.expectedTotalCents !== undefined && dto.expectedTotalCents !== totalCents) {
      throw conflict('PRICE_CHANGED', 'Os preços mudaram desde que você montou o pedido. Revise o carrinho.');
    }

    try {
      const created = await this.prisma.order.create({
        data: {
          userId: auth.userId,
          establishmentId: establishment.id,
          tableId: table?.id,
          tableLabel: table?.label,
          clientRequestId: dto.clientRequestId,
          totalCents,
          pickupCode: pickupCode(),
          items: { create: lines },
        },
        include: ORDER_INCLUDE,
      });
      this.realtime.orderUpdated(auth.userId, establishment.id, created.id);
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
    return toPage(orders.map(toStaffOrderDto), total, query);
  }

  /** Só avança um passo por vez (pago → preparo → pronto → entregue); pedido não pago nunca entra na cozinha. */
  async advanceStatus(establishmentId: string, orderId: string, status: OrderStatus): Promise<StaffOrderDto> {
    // Mesmo lock do estorno (`order:<id>`): avançar e estornar ao mesmo tempo nunca deixam o pedido entregue e estornado.
    const order = await this.prisma.$transaction(async tx => {
      await lockResource(tx, `order:${orderId}`);
      const current = await tx.order.findFirst({
        where: { id: orderId, establishmentId },
        select: { id: true, userId: true, status: true, payments: { where: { status: 'approved', refundRequestedAt: { not: null } }, select: { id: true }, take: 1 } },
      });
      if (!current) throw notFound('Pedido não encontrado.');
      if (STAFF_ORDER_TRANSITIONS[current.status] !== status) {
        throw unprocessable('INVALID_STATUS_TRANSITION', 'Este pedido não pode ir para esse status agora.');
      }
      if (current.payments.length > 0) throw conflict('REFUND_IN_PROGRESS', 'Há um estorno em andamento neste pedido. Conclua o estorno antes de avançar.');
      // Atualização condicional: duas pessoas avançando ao mesmo tempo não pulam etapas.
      const changed = await tx.order.updateMany({ where: { id: current.id, status: current.status }, data: { status } });
      if (changed.count === 0) throw conflict('ORDER_STATUS_CHANGED', 'O pedido foi atualizado por outra pessoa. Recarregue.');
      return current;
    });
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
