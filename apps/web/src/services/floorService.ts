import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { REALTIME_EVENTS, type FloorPlanDto } from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { useRealtime } from '@/lib/realtime';
import { createPersistentStore, useStore } from '@/lib/store';
import { createId } from '@/lib/utils';
import { QR_DIRECTORY, SEED_TABLE_OVERLAYS } from '@/data/qrDirectory';
import type { FloorLayout, FloorTable, TableLiveState, TableMerge } from '@/types/floor';
import { staffKeys } from './staffKeys';

const FREE_TABLE: TableLiveState = { status: 'free', people: 0 };
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

/** Layout no formato das telas (mesas + mesclagens locais da Sprint 2). */
export function useFloorLayout(establishmentId: string) {
  const plan = useFloorPlan(establishmentId);
  const merges = useStore(mergesStore)[establishmentId];
  const layout = useMemo(() => (plan.data ? toLayout(plan.data, merges ?? []) : null), [plan.data, merges]);
  return { ...plan, layout };
}

function toLayout(plan: FloorPlanDto, merges: TableMerge[]): FloorLayout {
  const tables = plan.tables.map(toTable);
  const ids = new Set(tables.map(table => table.id));
  return {
    version: plan.version,
    tables,
    merges: merges.filter(merge => merge.tableIds.every(id => ids.has(id))),
    updatedAt: plan.updatedAt,
  };
}

/** Versão mais recente do servidor (descarta o rascunho e recarrega). */
export async function fetchFloorLayout(establishmentId: string) {
  const plan = await queryClient.fetchQuery({ queryKey: staffKeys.floor(establishmentId), queryFn: () => fetchPlan(establishmentId), staleTime: 0 });
  return toLayout(plan, mergesStore.get()[establishmentId] ?? []);
}

/** Salva posição, formato e capacidade no servidor; a versão impede sobrescrever edição de outra pessoa. */
export async function saveFloorLayout(establishmentId: string, layout: Pick<FloorLayout, 'version' | 'tables' | 'merges'>) {
  const plan = await api.put<FloorPlanDto>(`/establishments/${establishmentId}/floor-plan`, {
    version: layout.version,
    tables: layout.tables.map(({ id, label, shape, capacity, x, y }) => ({ ...(isDraftTable({ id }) ? {} : { id }), label, shape, capacity, x, y })),
  });
  const saved = new Set(plan.tables.map(table => table.id));
  // Mesclagens com mesas que acabaram de ser criadas são refeitas depois de salvar (os ids mudam).
  mergesStore.set(prev => ({ ...prev, [establishmentId]: layout.merges.filter(merge => merge.tableIds.every(id => saved.has(id))) }));
  queryClient.setQueryData(staffKeys.floor(establishmentId), plan);
  return toLayout(plan, mergesStore.get()[establishmentId] ?? []);
}

/**
 * Ficha 61 (Sprint 2): copia mesas (posição, formato e capacidade) para outra unidade usando a
 * mesma gravação de planta da Sprint 1 — o servidor gera novos ids e QR Codes.
 */
export async function duplicateFloorLayout(sourceEstablishmentId: string, targetEstablishmentId: string) {
  const [source, target] = await Promise.all([fetchPlan(sourceEstablishmentId), fetchPlan(targetEstablishmentId)]);
  const plan = await api.put<FloorPlanDto>(`/establishments/${targetEstablishmentId}/floor-plan`, {
    version: target.version,
    tables: source.tables.map(({ label, shape, capacity, x, y }) => ({ label, shape, capacity, x, y })),
  });
  mergesStore.set(prev => ({ ...prev, [targetEstablishmentId]: [] }));
  queryClient.setQueryData(staffKeys.floor(targetEstablishmentId), plan);
}

/** Nova mesa no rascunho do editor, posicionada no centro da planta. */
export function createFloorTable(existing: FloorTable[]): FloorTable {
  const usedNumbers = existing.map(t => Number(t.label.replace(/\D/g, '')) || 0);
  const nextNumber = Math.max(0, ...usedNumbers) + 1;
  return { id: createId(DRAFT_ID_PREFIX.slice(0, -1)), label: `Mesa ${nextNumber}`, shape: 'square', capacity: 4, x: 50, y: 50, qrCode: '' };
}

// ─── Mesclagem de mesas (ficha 47, Sprint 2 — no navegador) ─────────────────

const mergesStore = createPersistentStore<Record<string, TableMerge[]>>('table-merges', {});

export function mergeTables<T extends Pick<FloorLayout, 'tables' | 'merges'>>(layout: T, tableIds: string[]): T {
  const merges = layout.merges.filter(m => !m.tableIds.some(id => tableIds.includes(id)));
  return { ...layout, merges: [...merges, { id: createId('merge'), tableIds }] };
}

export function unmergeTables<T extends Pick<FloorLayout, 'tables' | 'merges'>>(layout: T, mergeId: string): T {
  return { ...layout, merges: layout.merges.filter(m => m.id !== mergeId) };
}

export const findMergeForTable = (merges: TableMerge[], tableId: string) => merges.find(m => m.tableIds.includes(tableId)) ?? null;

export function mergeSummary(merge: TableMerge, tables: FloorTable[]) {
  const members = tables.filter(t => merge.tableIds.includes(t.id));
  return {
    members,
    label: `Mesas ${members.map(t => t.label.replace(/\D/g, '') || t.label).join(' + ')}`,
    capacity: members.reduce((sum, t) => sum + t.capacity, 0),
  };
}

// ─── Situação das mesas ─────────────────────────────────────────────────────

/**
 * Livre/ocupada vem do servidor (necessário para a fila de espera da ficha 21). Reservada e
 * chamado — e a ocupação gerada pelos pedidos simulados — são da Sprint 2 e ficam no navegador.
 */
const overlayStore = createPersistentStore<Record<string, TableLiveState>>('table-overlays', SEED_TABLE_OVERLAYS);

export function useTableLiveStates(establishmentId: string): Record<string, TableLiveState> {
  const { data } = useFloorPlan(establishmentId);
  const overlays = useStore(overlayStore);
  return useMemo(() => {
    const states: Record<string, TableLiveState> = {};
    for (const table of data?.tables ?? []) {
      const server: TableLiveState =
        table.occupancy.status === 'occupied'
          ? { status: 'occupied', people: table.occupancy.partySize, since: table.occupancy.since ?? undefined }
          : FREE_TABLE;
      const overlay = overlays[table.id];
      states[table.id] = overlay && (overlay.status !== 'occupied' || server.status === 'free') ? overlay : server;
    }
    return states;
  }, [data, overlays]);
}

export const getTableLiveState = (states: Record<string, TableLiveState>, tableId: string) => states[tableId] ?? FREE_TABLE;

/** Pedido simulado vinculado à mesa marca a mesa como ocupada no mapa do atendente. */
export function occupyTableLocally(tableId: string) {
  overlayStore.set(prev => {
    const current = prev[tableId];
    if (current?.status === 'called') return prev;
    return { ...prev, [tableId]: { status: 'occupied', people: Math.max(current?.people ?? 0, 1), since: new Date().toISOString() } };
  });
}

/** Mesa liberada no servidor: os status locais da Sprint 2 também são limpos. */
export function clearLocalTableStates(tableIds: string[]) {
  overlayStore.set(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !tableIds.includes(id))));
}

// ─── QR Code da mesa (ficha 02, Sprint 2) ───────────────────────────────────

/** Aceita o código puro ou uma URL cujo último segmento é o código. */
export function findTableByQrCode(rawCode: string) {
  const code = rawCode.trim().split('/').filter(Boolean).at(-1)?.toUpperCase() ?? '';
  const entry = QR_DIRECTORY[code];
  return entry ? { establishmentId: entry.establishmentId, table: { id: entry.tableId, label: entry.tableLabel } } : null;
}
