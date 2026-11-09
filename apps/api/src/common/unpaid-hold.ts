import type { Prisma } from '../generated/prisma/client.js';

/** Pedido sem pagamento por mais tempo que isto não segura mais pontos, cashback ou cupom (mesmo prazo do pedido). */
export const UNPAID_HOLD_MS = 30 * 60 * 1000;

/**
 * Pedidos não pagos e vencidos que ainda seguram benefícios (pontos, cashback ou cupom): são cancelados por
 * expiração e os benefícios voltam ao cliente (fichas 14, 15 e 56).
 */
export function expiredHoldWhere(userId?: string, now = Date.now()): Prisma.OrderWhereInput {
  return {
    ...(userId && { userId }),
    status: 'received',
    OR: [{ redeemedPoints: { gt: 0 } }, { cashbackUsedCents: { gt: 0 } }, { couponId: { not: null } }],
    createdAt: { lt: new Date(now - UNPAID_HOLD_MS) },
    payments: { none: { status: { in: ['pending', 'approved'] } } },
    tabId: null,
  };
}
