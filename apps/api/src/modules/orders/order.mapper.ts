import type { OrderDto, PaymentDto, StaffOrderDto } from '@filafacil/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { SIMULATED_ID_PREFIX } from '../payments/simulated-payment.gateway.js';

/** Tudo que o app precisa para exibir um pedido; o pagamento mais recente é o que vale. */
export const ORDER_INCLUDE = {
  items: { orderBy: { name: 'asc' } },
  establishment: { select: { name: true, pickupPoint: true, averageWaitMinutes: true } },
  payments: { orderBy: { attempt: 'desc' }, take: 1 },
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
    items: order.items.map(item => ({
      menuItemId: item.menuItemId,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      notes: item.notes,
    })),
    pickupPoint: order.establishment.pickupPoint,
    pickupCode: showPickupCode ? order.pickupCode : null,
    estimatedMinutes: IN_PREPARATION.has(order.status) ? order.establishment.averageWaitMinutes : null,
    payment: payment ? toPaymentDto(payment) : null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export const toStaffOrderDto = (order: OrderWithDetails & { user: { name: string } }): StaffOrderDto => {
  const payment = order.payments[0];
  return {
    ...toOrderDto(order),
    customerName: order.user.name,
    refundPending: payment?.status === 'approved' && payment.refundRequestedAt !== null,
  };
};
