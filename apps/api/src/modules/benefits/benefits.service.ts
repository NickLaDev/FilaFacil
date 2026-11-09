import { Injectable } from '@nestjs/common';
import {
  MIN_NET_CENTS,
  cashbackFor,
  couponDiscountFor,
  normalizeCouponCode,
  type CashbackDto,
  type CouponDto,
  type CouponState,
  type CouponValidationDto,
} from '@filafacil/shared';
import { unprocessable } from '../../common/http/app-error.js';
import { expiredHoldWhere } from '../../common/unpaid-hold.js';
import { lockResource } from '../../database/advisory-lock.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import { Prisma, type Coupon } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';

type Db = PrismaTx | PrismaService;

export interface PricedLine {
  menuItemId: string;
  unitPriceCents: number;
  quantity: number;
}

export interface ResolvedCoupon {
  coupon: Coupon;
  discountCents: number;
}

export const couponState = (coupon: Pick<Coupon, 'active' | 'startsAt' | 'endsAt' | 'maxUses'>, usedCount: number, now: Date): CouponState => {
  if (!coupon.active) return 'inactive';
  if (now < coupon.startsAt) return 'scheduled';
  if (now > coupon.endsAt) return 'expired';
  if (coupon.maxUses !== null && usedCount >= coupon.maxUses) return 'exhausted';
  return 'active';
};

export const toCouponDto = (coupon: Coupon, usedCount: number, now = new Date()): CouponDto => ({
  id: coupon.id,
  code: coupon.code,
  description: coupon.description,
  discountType: coupon.discountType,
  discountValue: coupon.discountValue,
  minOrderCents: coupon.minOrderCents,
  startsAt: coupon.startsAt.toISOString(),
  endsAt: coupon.endsAt.toISOString(),
  maxUses: coupon.maxUses,
  active: coupon.active,
  usedCount,
  state: couponState(coupon, usedCount, now),
});

/**
 * Cashback (ficha 15) e cupons (ficha 56). Tudo em centavos inteiros, calculado só no servidor.
 *
 * Cashback: o valor a ganhar é congelado na criação do pedido (regra vigente naquele momento) e creditado quando o
 * pedido é ENTREGUE com pagamento aprovado (ou comanda quitada). O razão tem chave única (pedido, tipo): toda
 * operação é idempotente. Saldo nunca fica negativo (uso conferido sob lock por usuário).
 *
 * Cupom: valida período, ativo, valor mínimo, limite de usos e uso único por cliente; o uso é gravado na criação do
 * pedido (índice único cupom+cliente) e liberado se o pedido for cancelado.
 */
@Injectable()
export class BenefitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  // ─── Cupom ────────────────────────────────────────────────────────────────

  /** Valida o cupom para este cliente, estabelecimento e subtotal. Lança 422 com código e mensagem claros. */
  async resolveCoupon(client: Db, input: { userId: string; establishmentId: string; code: string; subtotalCents: number; now: Date }): Promise<ResolvedCoupon> {
    const code = normalizeCouponCode(input.code);
    const coupon = await client.coupon.findUnique({ where: { establishmentId_code: { establishmentId: input.establishmentId, code } } });
    if (!coupon) throw unprocessable('COUPON_INVALID', 'Cupom inválido. Confira o código digitado.');
    if (!coupon.active) throw unprocessable('COUPON_INACTIVE', 'Este cupom não está mais disponível.');
    if (input.now < coupon.startsAt) throw unprocessable('COUPON_NOT_STARTED', 'Este cupom ainda não está valendo.');
    if (input.now > coupon.endsAt) throw unprocessable('COUPON_EXPIRED', 'Este cupom expirou.');
    if (input.subtotalCents < coupon.minOrderCents) {
      throw unprocessable('COUPON_MIN_ORDER', `Este cupom vale para pedidos a partir de R$ ${(coupon.minOrderCents / 100).toFixed(2).replace('.', ',')}.`);
    }
    // Uso preso em pedido não pago e vencido não conta: o cliente que desistiu do carrinho pode usar o cupom de novo.
    const live = { order: { NOT: expiredHoldWhere() } };
    const [used, mine] = await Promise.all([
      client.couponRedemption.count({ where: { couponId: coupon.id, ...live } }),
      client.couponRedemption.findFirst({ where: { couponId: coupon.id, userId: input.userId, ...live }, select: { id: true } }),
    ]);
    if (mine) throw unprocessable('COUPON_ALREADY_USED', 'Você já usou este cupom.');
    if (coupon.maxUses !== null && used >= coupon.maxUses) throw unprocessable('COUPON_EXHAUSTED', 'Este cupom atingiu o limite de usos.');
    const discountCents = couponDiscountFor(coupon.discountType, coupon.discountValue, input.subtotalCents);
    if (discountCents <= 0) throw unprocessable('COUPON_MIN_ORDER', 'O valor do pedido é baixo demais para aplicar este cupom.');
    return { coupon, discountCents };
  }

  async validateCoupon(userId: string, input: { establishmentId: string; code: string; subtotalCents: number }): Promise<CouponValidationDto> {
    const { coupon, discountCents } = await this.resolveCoupon(this.prisma, { userId, ...input, now: new Date() });
    return { code: coupon.code, description: coupon.description, discountCents, discountType: coupon.discountType, discountValue: coupon.discountValue };
  }

  /** Dentro da transação do pedido: reconfere sob lock e grava o uso. O índice único (cupom, cliente) barra a corrida. */
  async redeemCoupon(tx: PrismaTx, input: { userId: string; orderId: string; establishmentId: string; code: string; subtotalCents: number }): Promise<ResolvedCoupon> {
    const preview = await tx.coupon.findUnique({ where: { establishmentId_code: { establishmentId: input.establishmentId, code: normalizeCouponCode(input.code) } }, select: { id: true } });
    if (preview) await lockResource(tx, `coupon:${preview.id}`);
    const resolved = await this.resolveCoupon(tx, { ...input, now: new Date() });
    // Remove o uso antigo preso em pedido vencido (o pedido em si é cancelado pela varredura de expirados).
    await tx.couponRedemption.deleteMany({ where: { couponId: resolved.coupon.id, userId: input.userId, order: expiredHoldWhere(input.userId) } });
    try {
      await tx.couponRedemption.create({ data: { couponId: resolved.coupon.id, userId: input.userId, orderId: input.orderId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw unprocessable('COUPON_ALREADY_USED', 'Você já usou este cupom.');
      throw error;
    }
    return resolved;
  }

  // ─── Cashback ─────────────────────────────────────────────────────────────

  async balance(client: Db, userId: string): Promise<number> {
    const [sum, expired] = await Promise.all([
      client.cashbackEntry.aggregate({ where: { userId }, _sum: { cents: true } }),
      // Cashback preso em pedido não pago e vencido já conta como disponível (a devolução no razão acontece depois).
      client.order.aggregate({ where: { ...expiredHoldWhere(userId), cashbackUsedCents: { gt: 0 }, cashbackEntries: { none: { type: 'redeem_return' } } }, _sum: { cashbackUsedCents: true } }),
    ]);
    return (sum._sum.cents ?? 0) + (expired._sum.cashbackUsedCents ?? 0);
  }

  /** Maior cashback utilizável agora: limitado pelo saldo e pelo líquido mínimo do pedido. */
  maxUsable(balanceCents: number, payableCents: number) {
    return Math.max(Math.min(balanceCents, payableCents - MIN_NET_CENTS), 0);
  }

  /** Dentro da transação do pedido: confere o saldo sob lock e grava a saída no razão. */
  async reserveCashback(tx: PrismaTx, userId: string, orderId: string, cents: number, payableCents: number): Promise<void> {
    if (cents <= 0) return;
    await lockResource(tx, `cashback:${userId}`);
    const balance = await this.balance(tx, userId);
    if (cents > balance) throw unprocessable('INVALID_CASHBACK', 'Saldo de cashback insuficiente.');
    if (cents > this.maxUsable(balance, payableCents)) {
      throw unprocessable('INVALID_CASHBACK', `O total do pedido não pode ficar abaixo de R$ ${(MIN_NET_CENTS / 100).toFixed(2).replace('.', ',')}.`);
    }
    await tx.cashbackEntry.create({ data: { userId, orderId, type: 'redeem', cents: -cents, note: 'Uso no pedido' } });
  }

  /**
   * Cashback do pedido pela melhor regra ativa do estabelecimento (sem acumular regras). Regra por promoção só
   * conta os itens daquela promoção, enquanto ela está vigente. O valor elegível é proporcional ao líquido pago.
   */
  async cashbackForOrder(client: Db, input: { establishmentId: string; lines: PricedLine[]; subtotalCents: number; netCents: number; now: Date }): Promise<{ cents: number; ruleId: string | null }> {
    if (input.subtotalCents <= 0 || input.netCents <= 0) return { cents: 0, ruleId: null };
    const rules = await client.cashbackRule.findMany({
      where: { establishmentId: input.establishmentId, active: true },
      include: { promotion: { select: { startsAt: true, endsAt: true, items: { select: { menuItemId: true } } } } },
    });
    let best: { cents: number; ruleId: string | null } = { cents: 0, ruleId: null };
    for (const rule of rules) {
      let eligible: number;
      if (!rule.promotion) eligible = input.subtotalCents;
      else if (input.now < rule.promotion.startsAt || input.now > rule.promotion.endsAt) continue;
      else {
        const ids = new Set(rule.promotion.items.map(item => item.menuItemId));
        eligible = input.lines.filter(line => ids.has(line.menuItemId)).reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
      }
      const eligibleNet = Math.floor((eligible * input.netCents) / input.subtotalCents);
      const cents = cashbackFor(eligibleNet, rule.percent);
      if (cents > best.cents) best = { cents, ruleId: rule.id };
    }
    return best;
  }

  /** Crédito na entrega (com pagamento aprovado ou comanda quitada). Idempotente. */
  async earnForOrder(tx: PrismaTx, orderId: string): Promise<boolean> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { userId: true, status: true, cashbackEarnCents: true, tabSettledAt: true, payments: { where: { status: 'approved' }, select: { id: true }, take: 1 } },
    });
    if (!order || order.status !== 'delivered' || order.cashbackEarnCents <= 0) return false;
    if (order.payments.length === 0 && !order.tabSettledAt) return false;
    await lockResource(tx, `cashback:${order.userId}`);
    const created = await tx.cashbackEntry.createMany({
      data: [{ userId: order.userId, orderId, type: 'earn', cents: order.cashbackEarnCents, note: 'Cashback do pedido entregue' }],
      skipDuplicates: true,
    });
    if (created.count > 0) this.realtime.cashbackUpdated(order.userId);
    return created.count > 0;
  }

  /**
   * Cancelamento/estorno: devolve o cashback usado, reverte o ganho (sem deixar o saldo negativo) e libera o cupom.
   * Idempotente por (pedido, tipo).
   */
  async revertForOrder(tx: PrismaTx, orderId: string): Promise<void> {
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { userId: true, couponId: true, cashbackEntries: { select: { type: true, cents: true } } } });
    if (!order) return;
    if (order.couponId) await tx.couponRedemption.deleteMany({ where: { orderId } });
    if (order.cashbackEntries.length === 0) return;
    await lockResource(tx, `cashback:${order.userId}`);
    const has = (type: string) => order.cashbackEntries.find(entry => entry.type === type);
    const redeem = has('redeem');
    if (redeem && !has('redeem_return')) {
      await tx.cashbackEntry.createMany({ data: [{ userId: order.userId, orderId, type: 'redeem_return', cents: -redeem.cents, note: 'Cashback devolvido (pedido cancelado)' }], skipDuplicates: true });
    }
    const earn = has('earn');
    if (earn && !has('earn_reversal')) {
      const balance = await this.balance(tx, order.userId);
      const reversed = Math.min(earn.cents, Math.max(balance, 0));
      await tx.cashbackEntry.createMany({
        data: [{ userId: order.userId, orderId, type: 'earn_reversal', cents: -reversed, note: reversed < earn.cents ? 'Estorno parcial: saldo insuficiente' : 'Cashback revertido (pedido estornado)' }],
        skipDuplicates: true,
      });
    }
    this.realtime.cashbackUpdated(order.userId);
  }

  async overview(userId: string, limit = 30): Promise<CashbackDto> {
    const [balanceCents, pending, rows] = await Promise.all([
      this.balance(this.prisma, userId),
      this.prisma.order.aggregate({
        where: { userId, status: { in: ['received', 'paid', 'preparing', 'ready'] }, cashbackEarnCents: { gt: 0 } },
        _sum: { cashbackEarnCents: true },
      }),
      this.prisma.cashbackEntry.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 100),
        include: { order: { select: { number: true, establishment: { select: { name: true } } } } },
      }),
    ]);
    return {
      balanceCents,
      pendingCents: pending._sum.cashbackEarnCents ?? 0,
      entries: rows.map(row => ({
        id: row.id,
        type: row.type,
        cents: row.cents,
        orderNumber: row.order.number,
        establishmentName: row.order.establishment.name,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
