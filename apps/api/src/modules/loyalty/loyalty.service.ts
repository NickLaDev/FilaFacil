import { Injectable } from '@nestjs/common';
import {
  LOYALTY_CENTS_PER_POINT,
  LOYALTY_MIN_NET_CENTS,
  LOYALTY_REDEEM_BLOCK_CENTS,
  LOYALTY_REDEEM_BLOCK_POINTS,
  discountForPoints,
  maxRedeemablePoints,
  pointsEarnedForCents,
  type LoyaltyDto,
} from '@filafacil/shared';
import { unprocessable } from '../../common/http/app-error.js';
import { lockResource } from '../../database/advisory-lock.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

/** Pedido sem pagamento por mais tempo que isto não segura mais os pontos resgatados (mesmo prazo do pedido). */
const UNPAID_HOLD_MS = 30 * 60 * 1000;

/**
 * FilaZero Club (ficha 14). Razão (ledger) de pontos com chave única por (pedido, tipo): toda operação é
 * idempotente. Saldo = soma do razão e nunca fica negativo (resgate confere o saldo sob lock por usuário).
 */
@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Conta verificada (e-mail ou celular) participa do clube. */
  async isEligible(client: PrismaTx | PrismaService, userId: string): Promise<boolean> {
    const user = await client.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true, phoneVerifiedAt: true } });
    return Boolean(user && (user.emailVerifiedAt || user.phoneVerifiedAt));
  }

  async balance(client: PrismaTx | PrismaService, userId: string): Promise<number> {
    const sum = await client.loyaltyLedgerEntry.aggregate({ where: { userId }, _sum: { points: true } });
    // Pontos presos em pedido não pago e vencido já contam como disponíveis (a devolução no razão acontece depois).
    const expired = await client.order.aggregate({ where: this.expiredHoldWhere(userId), _sum: { redeemedPoints: true } });
    return (sum._sum.points ?? 0) + (expired._sum.redeemedPoints ?? 0);
  }

  /**
   * Resgate na criação do pedido (dentro da transação do pedido). Confere conta verificada, bloco de 100,
   * saldo e total mínimo; grava a saída no razão. Devolve o desconto em centavos.
   */
  async reserveRedeem(tx: PrismaTx, userId: string, orderId: string, points: number, subtotalCents: number): Promise<number> {
    if (points <= 0) return 0;
    await lockResource(tx, `loyalty:${userId}`);
    if (!(await this.isEligible(tx, userId))) throw unprocessable('INVALID_REDEEM', 'Confirme seu e-mail ou celular para usar pontos.');
    if (points % LOYALTY_REDEEM_BLOCK_POINTS !== 0) throw unprocessable('INVALID_REDEEM', `Resgate em múltiplos de ${LOYALTY_REDEEM_BLOCK_POINTS} pontos.`);
    const balance = await this.balance(tx, userId);
    if (points > balance) throw unprocessable('INVALID_REDEEM', 'Saldo de pontos insuficiente.');
    if (points > maxRedeemablePoints(balance, subtotalCents)) {
      throw unprocessable('INVALID_REDEEM', `O total do pedido não pode ficar abaixo de R$ ${(LOYALTY_MIN_NET_CENTS / 100).toFixed(2).replace('.', ',')}.`);
    }
    await tx.loyaltyLedgerEntry.create({ data: { userId, orderId, type: 'redeem', points: -points, note: 'Resgate no pedido' } });
    return discountForPoints(points);
  }

  /**
   * Crédito: 1 ponto por R$ 1 líquido, só com pedido ENTREGUE e pagamento aprovado (ou comanda quitada) e conta
   * verificada. Idempotente. Devolve true quando creditou agora.
   */
  async earnForOrder(tx: PrismaTx, orderId: string): Promise<boolean> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { userId: true, status: true, totalCents: true, tabSettledAt: true, payments: { where: { status: 'approved' }, select: { id: true }, take: 1 } },
    });
    if (!order || order.status !== 'delivered') return false;
    if (order.payments.length === 0 && !order.tabSettledAt) return false;
    const points = pointsEarnedForCents(order.totalCents);
    if (points <= 0) return false;
    await lockResource(tx, `loyalty:${order.userId}`);
    if (!(await this.isEligible(tx, order.userId))) return false;
    const created = await tx.loyaltyLedgerEntry.createMany({
      data: [{ userId: order.userId, orderId, type: 'earn', points, note: 'Pontos do pedido entregue' }],
      skipDuplicates: true,
    });
    return created.count > 0;
  }

  /**
   * Cancelamento/estorno: devolve os pontos resgatados e reverte os ganhos (sem deixar o saldo negativo).
   * Idempotente por (pedido, tipo).
   */
  async revertForOrder(tx: PrismaTx, orderId: string): Promise<void> {
    const entries = await tx.loyaltyLedgerEntry.findMany({ where: { orderId }, select: { userId: true, type: true, points: true } });
    const userId = entries[0]?.userId;
    if (!userId) return;
    await lockResource(tx, `loyalty:${userId}`);
    const has = (type: string) => entries.find(entry => entry.type === type);
    const redeem = has('redeem');
    if (redeem && !has('redeem_return')) {
      await tx.loyaltyLedgerEntry.createMany({ data: [{ userId, orderId, type: 'redeem_return', points: -redeem.points, note: 'Pontos devolvidos (pedido cancelado)' }], skipDuplicates: true });
    }
    const earn = has('earn');
    if (earn && !has('earn_reversal')) {
      const balance = await this.balance(tx, userId);
      const reversed = Math.min(earn.points, Math.max(balance, 0));
      await tx.loyaltyLedgerEntry.createMany({
        data: [{ userId, orderId, type: 'earn_reversal', points: -reversed, note: reversed < earn.points ? 'Estorno parcial: saldo insuficiente' : 'Pontos revertidos (pedido estornado)' }],
        skipDuplicates: true,
      });
    }
  }

  private expiredHoldWhere(userId: string): Prisma.OrderWhereInput {
    return {
      userId,
      status: 'received',
      redeemedPoints: { gt: 0 },
      createdAt: { lt: new Date(Date.now() - UNPAID_HOLD_MS) },
      payments: { none: { status: { in: ['pending', 'approved'] } } },
      tabId: null,
      loyaltyEntries: { none: { type: 'redeem_return' } },
    };
  }

  /** Pedidos não pagos e vencidos soltam os pontos resgatados (cancelamento por expiração). */
  async releaseExpired(userId: string): Promise<void> {
    const stale = await this.prisma.order.findMany({ where: this.expiredHoldWhere(userId), select: { id: true } });
    for (const { id } of stale) {
      await this.prisma.$transaction(async tx => {
        await lockResource(tx, `order:${id}`);
        // Reconfere sob o lock: cobrança criada depois da varredura impede o cancelamento por expiração.
        const cancelled = await tx.order.updateMany({ where: { id, status: 'received', payments: { none: { status: { in: ['pending', 'approved'] } } } }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'expired' } });
        if (cancelled.count > 0) await this.revertForOrder(tx, id);
      });
    }
  }

  async overview(userId: string, limit = 30): Promise<LoyaltyDto> {
    // Somente leitura: pedidos vencidos já liberam os pontos no saldo (ver `balance`); o cancelamento real é feito ao criar pedido.
    const [eligible, balancePoints, rows] = await Promise.all([
      this.isEligible(this.prisma, userId),
      this.balance(this.prisma, userId),
      this.prisma.loyaltyLedgerEntry.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 100), include: { order: { select: { number: true } } } }),
    ]);
    return {
      eligible,
      balancePoints,
      balanceValueCents: discountForPoints(Math.floor(balancePoints / LOYALTY_REDEEM_BLOCK_POINTS) * LOYALTY_REDEEM_BLOCK_POINTS),
      rules: { centsPerPoint: LOYALTY_CENTS_PER_POINT, redeemBlockPoints: LOYALTY_REDEEM_BLOCK_POINTS, redeemBlockCents: LOYALTY_REDEEM_BLOCK_CENTS, minNetCents: LOYALTY_MIN_NET_CENTS },
      entries: rows.map(row => ({ id: row.id, type: row.type, points: row.points, orderNumber: row.order.number, note: row.note, createdAt: row.createdAt.toISOString() })),
    };
  }

  notify(userId: string) {
    this.realtime.loyaltyUpdated(userId);
  }
}
