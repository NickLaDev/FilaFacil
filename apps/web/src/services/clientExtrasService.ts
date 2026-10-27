import { useQuery } from '@tanstack/react-query';
import {
  REALTIME_EVENTS,
  type LoyaltyDto,
  type MyTableCallDto,
  type OnboardingStateDto,
  type OrderDto,
  type OrderQueuePositionDto,
} from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { isRealtimeHealthy, useRealtime, useUserRealtime } from '@/lib/realtime';
import { ordersKey } from './orderService';

// Sprint 3 (cliente): posição na fila (51), cancelamento (10), onboarding (07), FilaZero Club (14), chamado (18).

const QUEUE_POLL_MS = 5_000;
const queueKey = (orderId: string) => ['queue-position', orderId] as const;

/** Posição ao vivo: invalida em `queue.updated`/`order.updated` e consulta a cada ~5 s se o tempo real cair. */
export function useQueuePosition(order: Pick<OrderDto, 'id' | 'status'> | null, restaurantId: string | null) {
  const enabled = Boolean(order && (order.status === 'paid' || order.status === 'preparing'));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['queue-position'] });
  useRealtime(enabled && restaurantId ? { restaurantId } : null, [REALTIME_EVENTS.queueUpdated], refresh);
  useUserRealtime([REALTIME_EVENTS.orderUpdated], refresh, enabled);
  return useQuery({
    queryKey: queueKey(order?.id ?? ''),
    enabled,
    queryFn: ({ signal }) => api.get<OrderQueuePositionDto>(`/orders/${order?.id}/queue-position`, undefined, signal),
    refetchInterval: () => (isRealtimeHealthy() ? 30_000 : QUEUE_POLL_MS),
  });
}

/** Cancelamento pelo cliente (só `received|paid`); pago ⇒ estorno automático. */
export async function cancelOrder(orderId: string) {
  try {
    const order = await api.post<OrderDto>(`/orders/${orderId}/cancel`);
    queryClient.setQueryData([...ordersKey, orderId], order);
    return order;
  } finally {
    void queryClient.invalidateQueries({ queryKey: ordersKey });
    void queryClient.invalidateQueries({ queryKey: ['loyalty'] });
  }
}

// Onboarding

const onboardingKey = ['onboarding'] as const;
export const useOnboarding = (enabled: boolean) =>
  useQuery({ queryKey: onboardingKey, enabled, queryFn: ({ signal }) => api.get<OnboardingStateDto>('/me/onboarding', undefined, signal) });

export async function completeOnboarding(skipped: boolean) {
  const state = await api.post<OnboardingStateDto>('/me/onboarding/complete', { skipped });
  queryClient.setQueryData(onboardingKey, state);
  return state;
}

// FilaZero Club

export function useLoyalty(enabled: boolean) {
  useUserRealtime([REALTIME_EVENTS.loyaltyUpdated], () => void queryClient.invalidateQueries({ queryKey: ['loyalty'] }), enabled);
  return useQuery({ queryKey: ['loyalty'], enabled, queryFn: ({ signal }) => api.get<LoyaltyDto>('/me/loyalty', { limit: 50 }, signal) });
}

// Chamado de garçom

export function useMyTableCall(tableId: string | null) {
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['my-call'] });
  useUserRealtime([REALTIME_EVENTS.tableCallUpdated], refresh, Boolean(tableId));
  return useQuery({
    queryKey: ['my-call', tableId],
    enabled: Boolean(tableId),
    queryFn: ({ signal }) => api.get<{ call: MyTableCallDto | null }>('/table-calls/mine', { tableId: tableId ?? '' }, signal).then(r => r.call),
    refetchInterval: () => (isRealtimeHealthy() ? false : QUEUE_POLL_MS),
  });
}
