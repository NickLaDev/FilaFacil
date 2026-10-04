// Sprint 2 (pedidos, pagamento e acompanhamento): ainda simulado no navegador, sem API.
import { useMemo } from 'react';
import { useNow } from '@/lib/hooks';
import { createPersistentStore, useStore } from '@/lib/store';
import { createId } from '@/lib/utils';
import { onlyDigits } from '@/lib/validation';
import { ORDERS } from '@/data/operations';
import type { Order, OrderLine, OrderStatus, PaymentMethod } from '@/types/order';
import { occupyTableLocally } from './floorService';

const ordersStore = createPersistentStore('orders-v2', ORDERS);
const DAY_MS = 24 * 60 * 60 * 1000;
const POPULARITY_WINDOW_MS = 30 * DAY_MS;

export const ORDER_STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'received', label: 'Pedido recebido' },
  { status: 'paid', label: 'Pagamento confirmado' },
  { status: 'preparing', label: 'Em preparo' },
  { status: 'ready', label: 'Pronto para retirada' },
  { status: 'delivered', label: 'Entregue' },
];

/**
 * Enquanto não existe backend/websocket, a "cozinha" é simulada: o status avança
 * pelo tempo decorrido desde o pedido. Trocar por eventos do servidor sem mexer nas telas.
 */
const STATUS_REACHED_AFTER_MS: Record<OrderStatus, number> = {
  received: 0,
  paid: 2_000,
  preparing: 12_000,
  ready: 40_000,
  delivered: 150_000,
};

export function getOrderStatus(order: Order, now: number): OrderStatus {
  if (order.completed) return 'delivered';
  const elapsed = now - Date.parse(order.createdAt);
  return [...ORDER_STEPS].reverse().find(step => elapsed >= STATUS_REACHED_AFTER_MS[step.status])?.status ?? 'received';
}

export function getEstimatedTime(status: OrderStatus) {
  if (status === 'received' || status === 'paid') return '18–23 min';
  if (status === 'preparing') return '10–15 min';
  return null;
}

export function useAccountOrders(accountId: string | null) {
  const orders = useStore(ordersStore);
  return useMemo(
    () => orders.filter(o => o.accountId === accountId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [orders, accountId],
  );
}

export function useOrder(orderId: string | null) {
  const orders = useStore(ordersStore);
  return orders.find(o => o.id === orderId) ?? null;
}

export interface PlaceOrderInput {
  accountId: string;
  establishmentId: string;
  establishmentName: string;
  table?: { id: string; label: string };
  lines: OrderLine[];
  paymentMethod: PaymentMethod;
  transactionId: string;
}

export function placeOrder(input: PlaceOrderInput): Order {
  const orders = ordersStore.get();
  const order: Order = {
    id: createId('order'),
    number: Math.max(183, ...orders.map(o => o.number)) + 1,
    accountId: input.accountId,
    establishmentId: input.establishmentId,
    establishmentName: input.establishmentName,
    tableId: input.table?.id,
    tableLabel: input.table?.label,
    lines: input.lines,
    total: input.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    paymentMethod: input.paymentMethod,
    transactionId: input.transactionId,
    pickupPoint: 'Balcão 2',
    pickupCode: String(Math.floor(1000 + Math.random() * 9000)),
    createdAt: new Date().toISOString(),
  };
  ordersStore.set(prev => [...prev, order]);
  // Pedido vinculado à mesa marca a mesa como ocupada no mapa do atendente (ficha 16).
  if (input.table) occupyTableLocally(input.table.id);
  return order;
}

/** Quantidade pedida por item nos últimos 30 dias — base do selo "+ pedido" (ficha 46). */
export function useItemOrderCounts() {
  const orders = useStore(ordersStore);
  const now = useNow(60 * 60 * 1000);
  return useMemo(() => {
    const since = now - POPULARITY_WINDOW_MS;
    const counts = new Map<string, number>();
    orders
      .filter(order => Date.parse(order.createdAt) >= since)
      .forEach(order => order.lines.forEach(line => counts.set(line.menuItemId, (counts.get(line.menuItemId) ?? 0) + line.quantity)));
    return counts;
  }, [orders, now]);
}

// ─── Pagamento (gateway simulado) ───────────────────────────────────────────

export interface CardInput {
  number: string;
  holder: string;
  expiry: string;
  cvv: string;
}

export type PaymentResult = { ok: true; transactionId: string } | { ok: false; reason: string };

/** Final de cartão que o gateway simulado recusa — permite testar o fluxo de falha. */
export const DECLINED_CARD_SUFFIX = '0002';

const PAYMENT_LATENCY_MS = 1800;

/** Dados de cartão nunca são persistidos; em produção vão tokenizados direto ao gateway. */
export function processPayment(method: PaymentMethod, card?: CardInput): Promise<PaymentResult> {
  return new Promise(resolve => {
    setTimeout(() => {
      if (method !== 'pix' && card && onlyDigits(card.number).endsWith(DECLINED_CARD_SUFFIX)) {
        resolve({ ok: false, reason: 'Pagamento recusado pela operadora do cartão.' });
        return;
      }
      resolve({ ok: true, transactionId: `${method === 'pix' ? 'PIX' : 'CARD'}-${createId('tx').slice(3).toUpperCase()}` });
    }, PAYMENT_LATENCY_MS);
  });
}
