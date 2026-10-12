import type { FloorTable, TableLiveState, TableMapDto } from '@/types/floor';

/** Mesa avulsa ou grupo de mesas mescladas — a unidade que o atendente enxerga e atende. */
export interface FloorUnit {
  key: string;
  label: string;
  capacity: number;
  tables: FloorTable[];
  /** Id do grupo mesclado; null para mesa avulsa. */
  groupId: string | null;
  /** Mesa usada nas ações; o servidor aplica a ação ao grupo inteiro. */
  actionTableId: string;
  state: TableLiveState;
}

const toTable = ({ id, label, shape, capacity, x, y, qrCode }: TableMapDto['tables'][number]): FloorTable => ({ id, label, shape, capacity, x, y, qrCode });

/** Grupos viram uma unidade só (ficha 47); o estado já vem resolvido pelo servidor (chamado > ocupada > reservada > livre). */
export function buildFloorUnits(map: TableMapDto): FloorUnit[] {
  const byId = new Map(map.tables.map(table => [table.id, table]));
  const standalone = map.tables
    .filter(table => !table.groupId)
    .map<FloorUnit>(table => ({
      key: table.id,
      label: table.label,
      capacity: table.capacity,
      tables: [toTable(table)],
      groupId: null,
      actionTableId: table.id,
      state: { status: table.status, people: table.partySize, since: table.since, pendingCall: table.pendingCall, reservation: table.reservation },
    }));
  const grouped = map.groups.flatMap<FloorUnit>(group => {
    const members = group.tableIds.flatMap(id => (byId.has(id) ? [toTable(byId.get(id)!)] : []));
    if (!members.length) return [];
    return [
      {
        key: group.id,
        label: group.label,
        capacity: group.capacity,
        tables: members,
        groupId: group.id,
        actionTableId: members[0].id,
        state: { status: group.status, people: group.partySize, since: group.since, pendingCall: group.pendingCall, reservation: group.reservation },
      },
    ];
  });
  return [...standalone, ...grouped];
}
