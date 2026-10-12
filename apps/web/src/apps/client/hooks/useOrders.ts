import { useMemo } from 'react';
import { isOrderActive, useAccountOrders } from '@/services/orderService';
import { useClient } from '../clientContext';

/** Pedidos do cliente vindos da API; atualizam sozinhos por WebSocket (e por consulta se ele cair). */
export function useClientOrders() {
  const { account } = useClient();
  const query = useAccountOrders(account?.id ?? null);
  return useMemo(() => {
    const orders = (query.data?.items ?? []).map(order => ({ order, status: order.status }));
    return { orders, active: orders.find(entry => isOrderActive(entry.order)) ?? null, isLoading: query.isPending && Boolean(account) };
  }, [query.data, query.isPending, account]);
}
