import { getTableLiveState, mergeSummary } from '@/services/floorService';
import type { FloorLayout, FloorTable, TableLiveState, TableMerge } from '@/types/floor';
import { mostUrgentStatus } from './tableStyles';

/** Mesa avulsa ou grupo de mesas mescladas — a unidade que o atendente enxerga e atende. */
export interface FloorUnit {
  key: string;
  label: string;
  capacity: number;
  tables: FloorTable[];
  merge: TableMerge | null;
}

export function buildFloorUnits(layout: Pick<FloorLayout, 'tables' | 'merges'>): FloorUnit[] {
  const mergedIds = new Set(layout.merges.flatMap(m => m.tableIds));
  const standalone: FloorUnit[] = layout.tables
    .filter(t => !mergedIds.has(t.id))
    .map(t => ({ key: t.id, label: t.label, capacity: t.capacity, tables: [t], merge: null }));
  const merged: FloorUnit[] = layout.merges.flatMap(merge => {
    const summary = mergeSummary(merge, layout.tables);
    return summary.members.length ? [{ key: merge.id, label: summary.label, capacity: summary.capacity, tables: summary.members, merge }] : [];
  });
  return [...standalone, ...merged];
}

export function unitLiveState(unit: FloorUnit, liveStates: Record<string, TableLiveState>): TableLiveState {
  const states = unit.tables.map(t => getTableLiveState(liveStates, t.id));
  const since = states
    .map(s => s.since)
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  return {
    status: mostUrgentStatus(states.map(s => s.status)),
    people: states.reduce((sum, s) => sum + s.people, 0),
    since,
  };
}
