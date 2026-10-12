import { useQuery, useQueryClient } from '@tanstack/react-query';
import { REALTIME_EVENTS, type OrderStatus, type Page, type StaffOrderDto } from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { isRealtimeHealthy, useRealtime } from '@/lib/realtime';
import { staffKeys } from './staffKeys';

const base = (establishmentId: string) => `/establishments/${establishmentId}/orders`;

const POLL_WITHOUT_REALTIME_MS = 5_000;

/** Fila da cozinha (ficha 09): pedidos pagos e ainda não entregues; atualiza quando chega pedido novo. */
export function useStaffOrders(establishmentId: string) {
  const client = useQueryClient();
  useRealtime({ establishmentId }, [REALTIME_EVENTS.orderUpdated], () => {
    void client.invalidateQueries({ queryKey: staffKeys.orders(establishmentId) });
  });
  return useQuery({
    queryKey: staffKeys.orders(establishmentId),
    queryFn: ({ signal }) => api.get<Page<StaffOrderDto>>(base(establishmentId), { pageSize: 100 }, signal),
    // Sem tempo real (queda ou conexão sem sessão), consulta a API periodicamente.
    refetchInterval: () => (isRealtimeHealthy() ? false : POLL_WITHOUT_REALTIME_MS),
  });
}

function refresh(establishmentId: string) {
  void queryClient.invalidateQueries({ queryKey: staffKeys.orders(establishmentId) });
}

/** O servidor valida a sequência (pago → preparo → pronto → entregue); o cliente recebe o aviso na hora. */
export async function advanceOrder(establishmentId: string, orderId: string, status: OrderStatus) {
  try {
    return await api.patch<StaffOrderDto>(`${base(establishmentId)}/${orderId}/status`, { status });
  } finally {
    refresh(establishmentId);
  }
}

/** Só quem tem a permissão `orders.refund` consegue; o estorno é feito no gateway de pagamento. */
export async function refundOrder(establishmentId: string, orderId: string) {
  try {
    return await api.post<StaffOrderDto>(`${base(establishmentId)}/${orderId}/refund`);
  } finally {
    refresh(establishmentId);
  }
}
