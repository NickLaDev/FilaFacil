import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  REALTIME_EVENTS,
  type CloseTabRequest,
  type CloseTabResponse,
  type CreatedPrinterDto,
  type DashboardDto,
  type IngredientDto,
  type KitchenStationDto,
  type OrderQueueDto,
  type Page,
  type PrinterDto,
  type RealtimeEvent,
  type ShiftDto,
  type ShiftHistoryDto,
  type StaffAlertDto,
  type StaffOrderDto,
  type StaffTableCallDto,
  type TabDto,
  type UpdateIngredientStockRequest,
} from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { isRealtimeHealthy, useRealtime } from '@/lib/realtime';
import { staffKeys } from './staffKeys';

// Sprint 3 (equipe): fila, estações, impressoras, alertas, turno, comandas, chamados, dashboard e estoque.

const base = (establishmentId: string) => `/establishments/${establishmentId}`;
const POLL_WITHOUT_REALTIME_MS = 5_000;
const fallbackPoll = () => (isRealtimeHealthy() ? false : POLL_WITHOUT_REALTIME_MS);
/** A idade dos pedidos cresce com o tempo sem nenhum evento: a fila recarrega de vez em quando mesmo com tempo real. */
const AGE_REFRESH_MS = 20_000;
const agePoll = () => (isRealtimeHealthy() ? AGE_REFRESH_MS : POLL_WITHOUT_REALTIME_MS);

type Key = readonly unknown[];

/** Consulta com invalidação por tempo real e polling quando o WebSocket não está saudável. */
function useLive<T>(establishmentId: string, key: Key, events: RealtimeEvent[], path: string, params?: Record<string, string | number | undefined>, enabledFlag = true, poll: () => number | false = fallbackPoll) {
  const enabled = enabledFlag && Boolean(establishmentId);
  const client = useQueryClient();
  useRealtime(enabled ? { establishmentId } : null, events, () => void client.invalidateQueries({ queryKey: key }));
  return useQuery({
    queryKey: [...key, params ?? {}],
    enabled,
    queryFn: ({ signal }) => api.get<T>(`${base(establishmentId)}${path}`, params as Record<string, string | number> | undefined, signal),
    refetchInterval: poll,
  });
}

const invalidate = (...keys: Key[]) => keys.forEach(queryKey => void queryClient.invalidateQueries({ queryKey }));

async function mutate<T>(establishmentId: string, request: Promise<T>, ...extra: ((id: string) => Key)[]) {
  try {
    return await request;
  } finally {
    invalidate(staffKeys.queue(establishmentId), staffKeys.orders(establishmentId), ...extra.map(k => k(establishmentId)));
  }
}

// ─── Fila (23), estações (24), estimativa (63), cancelamento (10) ───────────

export type QueueStatusFilter = 'paid' | 'preparing' | 'ready' | undefined;

export const useOrderQueue = (establishmentId: string, status?: QueueStatusFilter, stationId?: string) =>
  useLive<OrderQueueDto>(establishmentId, staffKeys.queue(establishmentId), [REALTIME_EVENTS.orderUpdated], '/orders/queue', { status, stationId }, true, agePoll);

export const markStationReady = (establishmentId: string, orderId: string, stationId: string | null) =>
  mutate(establishmentId, api.post<StaffOrderDto>(`${base(establishmentId)}/orders/${orderId}/items/ready`, { stationId }));

export const setOrderEstimate = (establishmentId: string, orderId: string, minutes: number) =>
  mutate(establishmentId, api.patch<StaffOrderDto>(`${base(establishmentId)}/orders/${orderId}/estimate`, { minutes }));

export const cancelOrderAsStaff = (establishmentId: string, orderId: string) =>
  mutate(establishmentId, api.post<StaffOrderDto>(`${base(establishmentId)}/orders/${orderId}/cancel`), staffKeys.tabs);

export function useStations(establishmentId: string) {
  return useQuery({
    queryKey: staffKeys.stations(establishmentId),
    queryFn: ({ signal }) => api.get<KitchenStationDto[]>(`${base(establishmentId)}/kitchen-stations`, undefined, signal),
  });
}

const stationChange = async <T,>(establishmentId: string, request: Promise<T>) => {
  try {
    return await request;
  } finally {
    invalidate(staffKeys.stations(establishmentId), staffKeys.menu(establishmentId), staffKeys.queue(establishmentId));
  }
};
export const createStation = (establishmentId: string, name: string) => stationChange(establishmentId, api.post<KitchenStationDto>(`${base(establishmentId)}/kitchen-stations`, { name }));
export const renameStation = (establishmentId: string, id: string, name: string) => stationChange(establishmentId, api.patch<KitchenStationDto>(`${base(establishmentId)}/kitchen-stations/${id}`, { name }));
export const deleteStation = (establishmentId: string, id: string) => stationChange(establishmentId, api.delete<void>(`${base(establishmentId)}/kitchen-stations/${id}`));

// ─── Impressoras (26) e alertas (26/50) ─────────────────────────────────────

export const usePrinters = (establishmentId: string) =>
  useLive<PrinterDto[]>(establishmentId, staffKeys.printers(establishmentId), [REALTIME_EVENTS.printersUpdated, REALTIME_EVENTS.alertsUpdated], '/printers');

const printerChange = async <T,>(establishmentId: string, request: Promise<T>) => {
  try {
    return await request;
  } finally {
    invalidate(staffKeys.printers(establishmentId), staffKeys.alerts(establishmentId));
  }
};
export const createPrinter = (establishmentId: string, input: { name: string; stationId?: string | null }) =>
  printerChange(establishmentId, api.post<CreatedPrinterDto>(`${base(establishmentId)}/printers`, input));
export const deletePrinter = (establishmentId: string, id: string) => printerChange(establishmentId, api.delete<void>(`${base(establishmentId)}/printers/${id}`));
/** Simula o dispositivo no painel (nenhum hardware real é testado). */
export const sendPrinterHeartbeat = (establishmentId: string, id: string) => printerChange(establishmentId, api.post<void>(`${base(establishmentId)}/printers/${id}/heartbeat`));

export const useAlerts = (establishmentId: string, enabled = true) =>
  useLive<StaffAlertDto[]>(establishmentId, staffKeys.alerts(establishmentId), [REALTIME_EVENTS.alertsUpdated], '/alerts', undefined, enabled);

export const dismissAlert = async (establishmentId: string, id: string) => {
  try {
    return await api.post<void>(`${base(establishmentId)}/alerts/${id}/dismiss`);
  } finally {
    invalidate(staffKeys.alerts(establishmentId));
  }
};

// ─── Turno (25) ─────────────────────────────────────────────────────────────

export function useCurrentShift(establishmentId: string) {
  const query = useLive<{ shift: ShiftDto | null }>(establishmentId, staffKeys.shift(establishmentId), [REALTIME_EVENTS.shiftUpdated], '/shift/current');
  return { ...query, data: query.data ? query.data.shift : undefined };
}

export const useShifts = (establishmentId: string) =>
  useLive<Page<ShiftDto>>(establishmentId, [...staffKeys.shift(establishmentId), 'list'], [REALTIME_EVENTS.shiftUpdated], '/shifts', { pageSize: 20 });

export const useShiftHistory = (establishmentId: string, shiftId: string | null) => {
  const query = useQuery({
    queryKey: [...staffKeys.shift(establishmentId), 'history', shiftId],
    enabled: Boolean(shiftId),
    queryFn: ({ signal }) => api.get<ShiftHistoryDto>(`${base(establishmentId)}/shifts/${shiftId}`, undefined, signal),
  });
  return query;
};

const shiftChange = async <T,>(establishmentId: string, request: Promise<T>) => {
  try {
    return await request;
  } finally {
    invalidate(staffKeys.shift(establishmentId));
  }
};
export const openShift = (establishmentId: string) => shiftChange(establishmentId, api.post<ShiftDto>(`${base(establishmentId)}/shift/open`));
export const closeShift = (establishmentId: string) => shiftChange(establishmentId, api.post<ShiftDto>(`${base(establishmentId)}/shift/close`));

// ─── Comandas (17/22) e chamados (18) ───────────────────────────────────────

export const useTabs = (establishmentId: string, status: 'open' | 'closed' = 'open') =>
  useLive<TabDto[]>(establishmentId, staffKeys.tabs(establishmentId), [REALTIME_EVENTS.tabsUpdated, REALTIME_EVENTS.orderUpdated], '/tabs', { status });

const tabChange = async <T,>(establishmentId: string, request: Promise<T>) => {
  try {
    return await request;
  } finally {
    invalidate(staffKeys.tabs(establishmentId), staffKeys.orders(establishmentId), staffKeys.queue(establishmentId), staffKeys.tableMap(establishmentId));
  }
};
export const openTab = (establishmentId: string, tableId: string) => tabChange(establishmentId, api.post<TabDto>(`${base(establishmentId)}/tables/${tableId}/tab`));
export const addOrderToTab = (establishmentId: string, tabId: string, orderId: string) =>
  tabChange(establishmentId, api.post<TabDto>(`${base(establishmentId)}/tabs/${tabId}/orders`, { orderId }));
export const removeOrderFromTab = (establishmentId: string, tabId: string, orderId: string) =>
  tabChange(establishmentId, api.delete<TabDto>(`${base(establishmentId)}/tabs/${tabId}/orders/${orderId}`));
export const closeTab = (establishmentId: string, tabId: string, request: CloseTabRequest) =>
  tabChange(establishmentId, api.post<CloseTabResponse>(`${base(establishmentId)}/tabs/${tabId}/close`, request));

export const useStaffCalls = (establishmentId: string) =>
  useLive<StaffTableCallDto[]>(establishmentId, staffKeys.calls(establishmentId), [REALTIME_EVENTS.tableCallUpdated, REALTIME_EVENTS.tablesUpdated], '/table-calls');

export const resolveCall = async (establishmentId: string, callId: string) => {
  try {
    return await api.post<void>(`${base(establishmentId)}/table-calls/${callId}/resolve`);
  } finally {
    invalidate(staffKeys.calls(establishmentId), staffKeys.tableMap(establishmentId));
  }
};

// ─── Dashboard (27) e estoque (50) ──────────────────────────────────────────

export const useDashboard = (establishmentId: string) =>
  useLive<DashboardDto>(establishmentId, staffKeys.dashboard(establishmentId), [REALTIME_EVENTS.orderUpdated, REALTIME_EVENTS.tablesUpdated, REALTIME_EVENTS.stockUpdated], '/dashboard', undefined, true, agePoll);

export const updateIngredientStock = async (establishmentId: string, ingredientId: string, request: UpdateIngredientStockRequest) => {
  try {
    return await api.put<IngredientDto>(`${base(establishmentId)}/ingredients/${ingredientId}/stock`, request);
  } finally {
    invalidate(staffKeys.ingredients(establishmentId), staffKeys.alerts(establishmentId));
  }
};

/** Pedidos ainda sem pagamento (`received`) da casa: candidatos a ir para a comanda (ficha 17). */
export function useUnpaidOrders(establishmentId: string) {
  const client = useQueryClient();
  useRealtime({ establishmentId }, [REALTIME_EVENTS.orderUpdated, REALTIME_EVENTS.tabsUpdated], () => void client.invalidateQueries({ queryKey: [...staffKeys.orders(establishmentId), 'unpaid'] }));
  return useQuery({
    queryKey: [...staffKeys.orders(establishmentId), 'unpaid'],
    queryFn: ({ signal }) => api.get<Page<StaffOrderDto>>(`${base(establishmentId)}/orders`, { status: 'received', pageSize: 100 }, signal),
    refetchInterval: fallbackPoll,
  });
}

/** Repete a verificação do estorno de uma comanda (seguro: nunca cobra nem estorna duas vezes). */
export const retryTabRefund = async (establishmentId: string, tabId: string) => {
  try {
    return await api.post<{ retried: number; stillPending: number }>(`${base(establishmentId)}/tabs/${tabId}/refunds/retry`);
  } finally {
    invalidate(staffKeys.alerts(establishmentId), staffKeys.tabs(establishmentId));
  }
};
