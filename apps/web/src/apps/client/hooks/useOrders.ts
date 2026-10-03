import { useNow } from '@/lib/hooks';
import { getOrderStatus, useAccountOrders } from '@/services/orderService';
import { useClient } from '../clientContext';

/** Pedidos do cliente com status recalculado a cada 2s (substitui o push do backend). */
export function useClientOrders() {
  const { account } = useClient();
  const orders = useAccountOrders(account?.id ?? null);
  const now = useNow(2000);
  const withStatus = orders.map(order => ({ order, status: getOrderStatus(order, now) }));
  const active = withStatus.find(entry => entry.status !== 'delivered') ?? null;
  return { orders: withStatus, active, now };
}
