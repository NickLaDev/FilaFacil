import type { OrderDto, OrderSettlement, PaymentDto, StaffOrderDto } from '@filafacil/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { SIMULATED_ID_PREFIX } from '../payments/simulated-payment.gateway.js';

/** Tudo que o app precisa para exibir um pedido; o pagamento mais recente é o que vale. */
export const ORDER_INCLUDE = {
  items: { orderBy: { name: 'asc' }, include: { station: { select: { name: true } } } },
  notifications: { orderBy: { createdAt: 'asc' } },
  establishment: { select: { name: true, pickupPoint: true, averageWaitMinutes: true } },
  payments: { orderBy: { attempt: 'desc' }, take: 1 },
  review: { select: { rating: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithDetails = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
type PaymentRow = OrderWithDetails['payments'][number];

export const toPaymentDto = (payment: PaymentRow): PaymentDto => ({
  id: payment.id,
  method: payment.method,
  status: payment.status,
  amountCents: payment.amountCents,
  transactionId: payment.providerPaymentId,
  simulated: payment.providerPaymentId?.startsWith(SIMULATED_ID_PREFIX) ?? false,
  pix:
    payment.method === 'pix' && payment.pixCopyPaste
      ? { copyPaste: payment.pixCopyPaste, qrBase64: payment.pixQrBase64, expiresAt: payment.pixExpiresAt?.toISOString() ?? null }
      : null,
  failureReason: payment.failureReason,
  approvedAt: payment.approvedAt?.toISOString() ?? null,
  refundedAt: payment.refundedAt?.toISOString() ?? null,
});

/** Estimativa ajustada pelo gestor (ficha 63) ou o tempo médio da casa. */
export const estimateOf = (order: { estimatedMinutesOverride: number | null; establishment: { averageWaitMinutes: number } }) =>
  order.estimatedMinutesOverride ?? order.establishment.averageWaitMinutes;

const IN_PREPARATION = new Set(['received', 'paid', 'preparing']);

export function toOrderDto(order: OrderWithDetails): OrderDto {
  const payment = order.payments[0];
  const showPickupCode = order.status === 'ready' || order.status === 'delivered';
  return {
    id: order.id,
    number: order.number,
    establishmentId: order.establishmentId,
    establishmentName: order.establishment.name,
    tableId: order.tableId,
    tableLabel: order.tableLabel,
    status: order.status,
    totalCents: order.totalCents,
    discountCents: order.discountCents,
    redeemedPoints: order.redeemedPoints,
    cashbackUsedCents: order.cashbackUsedCents,
    cashbackEarnCents: order.cashbackEarnCents,
    couponCode: order.couponCode,
    couponDiscountCents: order.couponDiscountCents,
    canReview: order.status === 'delivered' && order.review === null,
    reviewRating: order.review?.rating ?? null,
    items: order.items.map(item => ({
      menuItemId: item.menuItemId,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      notes: item.notes,
    })),
    pickupPoint: order.establishment.pickupPoint,
    pickupCode: showPickupCode ? order.pickupCode : null,
    estimatedMinutes: IN_PREPARATION.has(order.status) ? estimateOf(order) : null,
    estimateAdjusted: order.estimatedMinutesOverride !== null,
    cancellable: (order.status === 'received' || order.status === 'paid') && order.tabSettledAt === null,
    tabId: order.tabId,
    payment: payment ? toPaymentDto(payment) : null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export function settlementOf(order: OrderWithDetails): OrderSettlement {
  const payment = order.payments[0];
  if (payment?.status === 'refunded') return 'refunded';
  if (payment?.status === 'approved') return 'paid';
  if (order.tabSettledAt) return 'settled_on_tab';
  if (order.tabId && order.status !== 'cancelled') return 'on_tab';
  return 'unpaid';
}

export const ageMinutes = (order: { paidAt: Date | null; createdAt: Date }, now = new Date()) =>
  Math.max(0, Math.floor((now.getTime() - (order.paidAt ?? order.createdAt).getTime()) / 60_000));

export const toStaffOrderDto = (order: OrderWithDetails & { user: { name: string } }, now = new Date()): StaffOrderDto => {
  const payment = order.payments[0];
  const dto = toOrderDto(order);
  const age = ageMinutes(order, now);
  return {
    ...dto,
    items: order.items.map(item => ({
      menuItemId: item.menuItemId,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      notes: item.notes,
      stationId: item.stationId,
      stationName: item.station?.name ?? null,
      readyAt: item.readyAt?.toISOString() ?? null,
    })),
    customerName: order.user.name,
    refundPending: payment?.status === 'approved' && payment.refundRequestedAt !== null,
    settlement: settlementOf(order),
    ageMinutes: age,
    late: (order.status === 'paid' || order.status === 'preparing' || (order.status === 'received' && order.tabId !== null)) && age > estimateOf(order),
    notifications: order.notifications.map(n => ({
      channel: n.channel as 'in_app' | 'email' | 'sms',
      status: n.status,
      errorCode: n.errorCode,
      createdAt: n.createdAt.toISOString(),
    })),
  };
};
