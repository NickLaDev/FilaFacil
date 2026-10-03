import { createPersistentStore, useStore } from '@/lib/store';
import { createId } from '@/lib/utils';
import { FLOOR_LAYOUTS, TABLE_LIVE_STATES } from '@/data/floor';
import type { FloorLayout, FloorTable, TableLiveState, TableMerge } from '@/types/floor';

const layoutsStore = createPersistentStore('floor-layouts', FLOOR_LAYOUTS);
const liveStatesStore = createPersistentStore('table-live-states', TABLE_LIVE_STATES);

const EMPTY_LAYOUT: FloorLayout = { tables: [], merges: [], updatedAt: '' };
const FREE_TABLE: TableLiveState = { status: 'free', people: 0 };

// ─── Planta (layout por estabelecimento) ────────────────────────────────────

export function useFloorLayout(establishmentId: string) {
  const layouts = useStore(layoutsStore);
  return layouts[establishmentId] ?? EMPTY_LAYOUT;
}

export const getFloorLayout = (establishmentId: string) => layoutsStore.get()[establishmentId] ?? EMPTY_LAYOUT;

/** A mesma planta salva alimenta o mapa de mesas do atendente (fichas 20 e 47). */
export function saveFloorLayout(establishmentId: string, layout: Pick<FloorLayout, 'tables' | 'merges'>) {
  layoutsStore.set(prev => ({ ...prev, [establishmentId]: { ...layout, updatedAt: new Date().toISOString() } }));
}

/** Copia mesas (posição, formato e capacidade) para outra unidade; a planta original não muda (ficha 61). */
export function duplicateFloorLayout(sourceEstablishmentId: string, targetEstablishmentId: string, targetQrPrefix: string) {
  const source = getFloorLayout(sourceEstablishmentId);
  const usedCodes = collectQrCodes();
  const tables = source.tables.map(t => {
    const qrCode = generateQrCode(targetQrPrefix, usedCodes);
    usedCodes.add(qrCode);
    return { ...t, id: createId('tbl'), qrCode };
  });
  saveFloorLayout(targetEstablishmentId, { tables, merges: [] });
}

function collectQrCodes() {
  return new Set(Object.values(layoutsStore.get()).flatMap(layout => layout.tables.map(t => t.qrCode)));
}

function generateQrCode(prefix: string, usedCodes: Set<string>) {
  let code: string;
  do {
    code = `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
  } while (usedCodes.has(code));
  return code;
}

/** Prefixo legível do QR a partir do nome (ex.: "Bar do Mestre" → "MESTRE"). */
export function qrPrefixFromName(name: string) {
  const words = name
    .normalize('NFD')
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2 && !/^\d+$/.test(word));
  return (words.at(-1) ?? 'MESA').toUpperCase().slice(0, 8);
}

/** Nova mesa com QR Code único, posicionada no centro da planta. */
export function createFloorTable(existing: FloorTable[], qrPrefix: string): FloorTable {
  const usedCodes = collectQrCodes();
  existing.forEach(t => usedCodes.add(t.qrCode));
  const usedNumbers = existing.map(t => Number(t.label.replace(/\D/g, '')) || 0);
  const nextNumber = Math.max(0, ...usedNumbers) + 1;
  return {
    id: createId('tbl'),
    label: `Mesa ${nextNumber}`,
    shape: 'square',
    capacity: 4,
    x: 50,
    y: 50,
    qrCode: generateQrCode(qrPrefix, usedCodes),
  };
}

/** Aceita o código puro ou uma URL cujo último segmento é o código. */
export function findTableByQrCode(rawCode: string) {
  const code = rawCode.trim().split('/').filter(Boolean).at(-1)?.toUpperCase() ?? '';
  for (const [establishmentId, layout] of Object.entries(layoutsStore.get())) {
    const table = layout.tables.find(t => t.qrCode === code);
    if (table) return { establishmentId, table };
  }
  return null;
}

// ─── Mesclagem (aplicada no rascunho da planta e salva junto) ───────────────

export function mergeTables(layout: Pick<FloorLayout, 'tables' | 'merges'>, tableIds: string[]) {
  const merges = layout.merges.filter(m => !m.tableIds.some(id => tableIds.includes(id)));
  return { ...layout, merges: [...merges, { id: createId('merge'), tableIds }] };
}

export function unmergeTables(layout: Pick<FloorLayout, 'tables' | 'merges'>, mergeId: string) {
  return { ...layout, merges: layout.merges.filter(m => m.id !== mergeId) };
}

export const findMergeForTable = (merges: TableMerge[], tableId: string) =>
  merges.find(m => m.tableIds.includes(tableId)) ?? null;

export function mergeSummary(merge: TableMerge, tables: FloorTable[]) {
  const members = tables.filter(t => merge.tableIds.includes(t.id));
  return {
    members,
    label: `Mesas ${members.map(t => t.label.replace(/\D/g, '') || t.label).join(' + ')}`,
    capacity: members.reduce((sum, t) => sum + t.capacity, 0),
  };
}

// ─── Situação operacional das mesas ─────────────────────────────────────────

export const useTableLiveStates = () => useStore(liveStatesStore);
export const getTableLiveStates = () => liveStatesStore.get();

export const getTableLiveState = (states: Record<string, TableLiveState>, tableId: string) => states[tableId] ?? FREE_TABLE;

export function setTableLiveState(tableId: string, state: TableLiveState) {
  liveStatesStore.set(prev => ({ ...prev, [tableId]: state }));
}
