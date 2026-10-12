import { useQuery } from '@tanstack/react-query';
import { REALTIME_EVENTS, type CreateOrderRequest, type CreatePaymentRequest, type OrderDto, type Page } from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { isRealtimeHealthy, useUserRealtime } from '@/lib/realtime';
import { createId } from '@/lib/utils';

// Fichas 04, 08 e 09: pedidos, pagamento e andamento vêm da API (nada é simulado no navegador).

export const ordersKey = ['orders'] as const;
const orderKey = (orderId: string) => [...ordersKey, orderId] as const;

export const ORDER_STEPS: { status: OrderDto['status']; label: string }[] = [
  { status: 'received', label: 'Pedido recebido' },
  { status: 'paid', label: 'Pagamento confirmado' },
  { status: 'preparing', label: 'Em preparo' },
  { status: 'ready', label: 'Pronto para retirada' },
  { status: 'delivered', label: 'Entregue' },
];

/** Pagamento aprovado e pedido ainda a caminho do cliente (pronto para a cozinha ou em preparo). */
export const isOrderActive = (order: OrderDto) => order.status === 'paid' || order.status === 'preparing' || order.status === 'ready';

/** Pedido criado mas ainda não pago aparece como "aguardando pagamento", não como "recebido". */
export function orderStatusLabel(order: OrderDto) {
  if (order.status === 'cancelled') return 'Cancelado';
  if (order.status === 'received') return 'Aguardando pagamento';
  return ORDER_STEPS.find(step => step.status === order.status)?.label ?? '';
}

const WAIT_RANGE_MINUTES = 5;

/** Estimativa de preparo informada pela casa (mesma faixa exibida nos cards de restaurante). */
export const formatEstimate = (order: Pick<OrderDto, 'estimatedMinutes'>) =>
  order.estimatedMinutes === null ? null : `${order.estimatedMinutes}–${order.estimatedMinutes + WAIT_RANGE_MINUTES} min`;

/**
 * Meta: o cliente vê a mudança de status em até 5 s. Com o tempo real funcionando (conectado E autenticado) o
 * aviso chega por push e a consulta é só rede de segurança; sem ele — queda, sessão não autenticada no socket —
 * a API é consultada a cada 4 s.
 */
const POLL_WITHOUT_REALTIME_MS = 4_000;
const POLL_WITH_REALTIME_MS = 30_000;
const pollInterval = (active: boolean) => (active ? (isRealtimeHealthy() ? POLL_WITH_REALTIME_MS : POLL_WITHOUT_REALTIME_MS) : false);

/** Atualiza o cache assim que a API avisa que um pedido mudou. */
export function useOrderUpdates(enabled = true) {
  useUserRealtime([REALTIME_EVENTS.orderUpdated], () => void queryClient.invalidateQueries({ queryKey: ordersKey }), enabled);
}

/** Pedidos da conta, do mais recente ao mais antigo. */
export function useAccountOrders(accountId: string | null) {
  useOrderUpdates(Boolean(accountId));
  return useQuery({
    queryKey: [...ordersKey, 'list', accountId],
    queryFn: ({ signal }) => api.get<Page<OrderDto>>('/orders', { pageSize: 100 }, signal),
    enabled: Boolean(accountId),
    refetchInterval: query => pollInterval(Boolean(query.state.data?.items.some(isOrderActive))),
  });
}

/** Um pedido (rastreio, confirmação, comprovante). */
export function useOrder(orderId: string | null) {
  useOrderUpdates(Boolean(orderId));
  return useQuery({
    queryKey: orderKey(orderId ?? ''),
    queryFn: ({ signal }) => api.get<OrderDto>(`/orders/${orderId}`, undefined, signal),
    enabled: Boolean(orderId),
    refetchInterval: query => pollInterval(Boolean(query.state.data && (isOrderActive(query.state.data) || query.state.data.status === 'received'))),
  });
}

function remember(order: OrderDto) {
  queryClient.setQueryData(orderKey(order.id), order);
  void queryClient.invalidateQueries({ queryKey: [...ordersKey, 'list'] });
  return order;
}

// ─── Checkout ───────────────────────────────────────────────────────────────

interface CheckoutAttempt {
  /** Resumo do carrinho: mudou o carrinho, começa outro pedido. */
  signature: string;
  clientRequestId: string;
  orderId: string | null;
}

/**
 * Tentativa de checkout em andamento. Fica fora do componente para sobreviver a sair e voltar da tela de
 * pagamento: repetir a tentativa reaproveita o mesmo pedido (e a API também deduplica pelo identificador).
 */
let attempt: CheckoutAttempt | null = null;

export function checkoutAttempt(signature: string): CheckoutAttempt {
  if (!attempt || attempt.signature !== signature) attempt = { signature, clientRequestId: createId('checkout'), orderId: null };
  return attempt;
}

export const finishCheckout = () => {
  attempt = null;
};

export const createOrder = (request: CreateOrderRequest) => api.post<OrderDto>('/orders', request).then(remember);

export const payOrder = (orderId: string, request: CreatePaymentRequest) => api.post<OrderDto>(`/orders/${orderId}/payments`, request).then(remember);

/** Demonstração (só com o gateway simulado): o dono do pedido "paga" o Pix simulado; o servidor aplica o resultado. */
export const simulatePixPayment = (orderId: string) => api.post<OrderDto>(`/orders/${orderId}/payments/demo-confirm`).then(remember);

/** Consulta o gateway de pagamento pelo servidor (o webhook faz o mesmo quando consegue chegar). */
export const syncOrderPayment = (orderId: string) => api.post<OrderDto>(`/orders/${orderId}/payments/sync`).then(remember);
