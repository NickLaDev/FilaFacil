import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { REALTIME_EVENTS, type FloorPlanDto, type QrResolveDto } from '@filafacil/shared';
import { api, isApiError } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { isRealtimeHealthy, useRealtime } from '@/lib/realtime';
import { createId } from '@/lib/utils';
import type { DuplicateTarget, FloorLayout, FloorTable, TableCheckDto, TableMapDto } from '@/types/floor';
import { staffKeys } from './staffKeys';

/** Mesas novas ganham id definitivo e QR Code no servidor ao salvar a planta. */
const DRAFT_ID_PREFIX = 'draft-';

export const isDraftTable = (table: Pick<FloorTable, 'id'>) => table.id.startsWith(DRAFT_ID_PREFIX);

// ─── Planta (ficha 20 — servidor) ───────────────────────────────────────────

const toTable = ({ id, label, shape, capacity, x, y, qrCode }: FloorPlanDto['tables'][number]): FloorTable => ({ id, label, shape, capacity, x, y, qrCode });

const fetchPlan = (establishmentId: string, signal?: AbortSignal) =>
  api.get<FloorPlanDto>(`/establishments/${establishmentId}/floor-plan`, undefined, signal);

/** Planta salva + ocupação real das mesas. A mesma leitura alimenta o editor do gestor e o mapa do atendente. */
export function useFloorPlan(establishmentId: string) {
  const client = useQueryClient();
  useRealtime({ establishmentId }, [REALTIME_EVENTS.floorPlanUpdated], () => {
    void client.invalidateQueries({ queryKey: staffKeys.floor(establishmentId) });
  });
  return useQuery({ queryKey: staffKeys.floor(establishmentId), queryFn: ({ signal }) => fetchPlan(establishmentId, signal) });
}

/** Layout no formato das telas (mesas da planta salva). */
export function useFloorLayout(establishmentId: string) {
  const plan = useFloorPlan(establishmentId);
  const layout = useMemo(() => (plan.data ? toLayout(plan.data) : null), [plan.data]);
  return { ...plan, layout };
}

function toLayout(plan: FloorPlanDto): FloorLayout {
  return { version: plan.version, tables: plan.tables.map(toTable), updatedAt: plan.updatedAt };
}

/** Versão mais recente do servidor (descarta o rascunho e recarrega). */
export async function fetchFloorLayout(establishmentId: string) {
  return toLayout(await queryClient.fetchQuery({ queryKey: staffKeys.floor(establishmentId), queryFn: () => fetchPlan(establishmentId), staleTime: 0 }));
}

/** Salva posição, formato e capacidade no servidor; a versão impede sobrescrever edição de outra pessoa. */
export async function saveFloorLayout(establishmentId: string, layout: Pick<FloorLayout, 'version' | 'tables'>) {
  const plan = await api.put<FloorPlanDto>(`/establishments/${establishmentId}/floor-plan`, {
    version: layout.version,
    tables: layout.tables.map(({ id, label, shape, capacity, x, y }) => ({ ...(isDraftTable({ id }) ? {} : { id }), label, shape, capacity, x, y })),
  });
  queryClient.setQueryData(staffKeys.floor(establishmentId), plan);
  void queryClient.invalidateQueries({ queryKey: staffKeys.tableMap(establishmentId) });
  return toLayout(plan);
}

/** Ficha 61: unidades da organização para onde a planta pode ser copiada (plano e permissão checados no servidor). */
export function useDuplicateTargets(sourceEstablishmentId: string) {
  return useQuery({
    queryKey: [...staffKeys.floor(sourceEstablishmentId), 'duplicate-targets'],
    queryFn: ({ signal }) => api.get<DuplicateTarget[]>(`/establishments/${sourceEstablishmentId}/floor-plan/duplicate-targets`, undefined, signal),
  });
}

/** Copia mesas, posições e capacidades de `source` para `target`; a origem não muda e o destino segue editável. */
export async function duplicateFloorLayout(sourceEstablishmentId: string, targetEstablishmentId: string, replace: boolean) {
  const plan = await api.post<FloorPlanDto>(`/establishments/${sourceEstablishmentId}/floor-plan/duplicate`, { targetEstablishmentId, replace });
  queryClient.setQueryData(staffKeys.floor(targetEstablishmentId), plan);
  void queryClient.invalidateQueries({ queryKey: staffKeys.tableMap(targetEstablishmentId) });
}

/** Nova mesa no rascunho do editor, posicionada no centro da planta. */
export function createFloorTable(existing: FloorTable[]): FloorTable {
  const usedNumbers = existing.map(t => Number(t.label.replace(/\D/g, '')) || 0);
  const nextNumber = Math.max(0, ...usedNumbers) + 1;
  return { id: createId(DRAFT_ID_PREFIX.slice(0, -1)), label: `Mesa ${nextNumber}`, shape: 'square', capacity: 4, x: 50, y: 50, qrCode: '' };
}

// ─── Mapa de mesas ao vivo e mesclagem (fichas 16 e 47 — servidor) ──────────

/** Estado de todas as mesas; qualquer mudança (pedido, chamado, pagamento, mesclagem) chega por WebSocket. */
export function useTableMap(establishmentId: string) {
  const client = useQueryClient();
  useRealtime({ establishmentId }, [REALTIME_EVENTS.tablesUpdated, REALTIME_EVENTS.floorPlanUpdated, REALTIME_EVENTS.orderUpdated], () => {
    void client.invalidateQueries({ queryKey: staffKeys.tableMap(establishmentId) });
  });
  return useQuery({
    queryKey: staffKeys.tableMap(establishmentId),
    queryFn: ({ signal }) => api.get<TableMapDto>(`/establishments/${establishmentId}/table-map`, undefined, signal),
    // Rede de segurança caso o WebSocket esteja bloqueado (sem WebSocket autenticado consulta a cada 3 s: ficha 16).
    refetchInterval: () => (isRealtimeHealthy() ? 15_000 : 3_000),
  });
}

const tablePath = (establishmentId: string, tableId: string) => `/establishments/${establishmentId}/tables/${tableId}`;

async function mapAction(establishmentId: string, request: Promise<TableMapDto>) {
  const map = await request;
  queryClient.setQueryData(staffKeys.tableMap(establishmentId), map);
  return map;
}

export const occupyTable = (establishmentId: string, tableId: string, partySize: number) =>
  mapAction(establishmentId, api.post<TableMapDto>(`${tablePath(establishmentId, tableId)}/occupy`, { partySize }));

export const releaseTable = (establishmentId: string, tableId: string) =>
  mapAction(establishmentId, api.post<TableMapDto>(`${tablePath(establishmentId, tableId)}/release`));

export const reserveTable = (establishmentId: string, tableId: string, input: { name: string; partySize: number; reservedAt?: string }) =>
  mapAction(establishmentId, api.post<TableMapDto>(`${tablePath(establishmentId, tableId)}/reservations`, input));

export const cancelReservation = (establishmentId: string, tableId: string, reservationId: string) =>
  mapAction(establishmentId, api.delete<TableMapDto>(`${tablePath(establishmentId, tableId)}/reservations/${reservationId}`));

export const resolveTableCall = (establishmentId: string, tableId: string) =>
  mapAction(establishmentId, api.post<TableMapDto>(`${tablePath(establishmentId, tableId)}/calls/resolve`));

/** Ficha 47: une duas ou mais mesas salvas em um grupo (capacidade somada, comanda única). */
export const mergeTables = (establishmentId: string, tableIds: string[]) =>
  mapAction(establishmentId, api.post<TableMapDto>(`/establishments/${establishmentId}/table-groups`, { tableIds }));

export const unmergeTables = (establishmentId: string, groupId: string) =>
  mapAction(establishmentId, api.delete<TableMapDto>(`/establishments/${establishmentId}/table-groups/${groupId}`));

/** Comanda da mesa ou do grupo mesclado. */
export function useTableCheck(establishmentId: string, tableId: string | null) {
  return useQuery({
    queryKey: [...staffKeys.tableMap(establishmentId), 'check', tableId],
    enabled: Boolean(tableId),
    queryFn: ({ signal }) => api.get<TableCheckDto>(`/establishments/${establishmentId}/table-checks/${tableId}`, undefined, signal),
  });
}

// ─── QR Code da mesa (ficha 02) ─────────────────────────────────────────────

/**
 * Conteúdo impresso no QR Code: um link do próprio app com o código da mesa. A câmera nativa abre o
 * app já na mesa; o leitor interno e o campo de digitação aceitam o link ou só o código.
 */
export const QR_LINK_PARAM = 'mesa';

export const qrPayloadFor = (code: string) => `${window.location.origin}/?${QR_LINK_PARAM}=${encodeURIComponent(code)}`;

/** Extrai o código de um link do app, de uma URL qualquer terminada no código ou do código puro. */
export function parseQrPayload(raw: string) {
  const text = raw.trim();
  let candidate: string;
  try {
    const url = new URL(text);
    candidate = url.searchParams.get(QR_LINK_PARAM) ?? url.pathname.split('/').filter(Boolean).at(-1) ?? '';
  } catch {
    candidate = text.split('/').filter(Boolean).at(-1) ?? '';
  }
  return candidate.trim().toUpperCase();
}

/** Pergunta ao servidor a qual mesa o código pertence; `null` = código desconhecido (ou casa indisponível). */
export async function resolveQrCode(raw: string) {
  const code = parseQrPayload(raw);
  if (!/^[A-Z0-9-]{3,32}$/.test(code)) return null;
  try {
    return await api.get<QrResolveDto>(`/restaurants/qr/${encodeURIComponent(code)}`);
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null;
    throw error;
  }
}
