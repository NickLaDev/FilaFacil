import { useMemo } from 'react';
import { createPersistentStore, useStore } from '@/lib/store';
import { createId } from '@/lib/utils';
import { WAITLIST } from '@/data/operations';
import type { FloorTable } from '@/types/floor';
import type { WaitlistEntry } from '@/types/waitlist';
import { setTableLiveState } from './floorService';

const waitlistStore = createPersistentStore('waitlist', WAITLIST);

/** Tempo médio para uma mesa compatível vagar — base da estimativa enquanto não há histórico real. */
const AVERAGE_TABLE_TURNOVER_MIN = 12;

/** A ordem do array é a ordem da fila. */
export function useWaitlist(establishmentId: string) {
  const entries = useStore(waitlistStore);
  return useMemo(() => entries.filter(e => e.establishmentId === establishmentId), [entries, establishmentId]);
}

export function addToWaitlist(establishmentId: string, input: Pick<WaitlistEntry, 'name' | 'phone' | 'partySize'>) {
  const entry: WaitlistEntry = {
    ...input,
    id: createId('wait'),
    establishmentId,
    joinedAt: new Date().toISOString(),
    status: 'waiting',
  };
  waitlistStore.set(prev => [...prev, entry]);
}

export function removeFromWaitlist(id: string) {
  waitlistStore.set(prev => prev.filter(e => e.id !== id));
}

export function moveInWaitlist(id: string, direction: -1 | 1) {
  waitlistStore.set(prev => {
    const entry = prev.find(e => e.id === id);
    if (!entry) return prev;
    const sameQueue = prev.filter(e => e.establishmentId === entry.establishmentId);
    const position = sameQueue.indexOf(entry);
    const neighbor = sameQueue[position + direction];
    if (!neighbor) return prev;
    const next = [...prev];
    next[prev.indexOf(entry)] = neighbor;
    next[prev.indexOf(neighbor)] = entry;
    return next;
  });
}

/** Em produção dispara SMS/push pelo backend; aqui só registra o aviso. */
export function notifyParty(id: string, tableLabel?: string) {
  waitlistStore.set(prev =>
    prev.map(e => (e.id === id ? { ...e, status: 'notified', notifiedAt: new Date().toISOString(), notifiedTableLabel: tableLabel } : e)),
  );
}

/** Grupos à frente consomem as mesas livres compatíveis; o restante espera o giro médio. */
export function estimateWaitMinutes(groupsAhead: number, freeCompatibleTables: number) {
  if (groupsAhead < freeCompatibleTables) return 0;
  return (groupsAhead - freeCompatibleTables + 1) * AVERAGE_TABLE_TURNOVER_MIN;
}

/** Libera a mesa e avisa automaticamente o primeiro grupo que cabe nela (ficha 21). */
export function releaseTable(establishmentId: string, table: FloorTable, capacity = table.capacity) {
  setTableLiveState(table.id, { status: 'free', people: 0 });
  const next = waitlistStore
    .get()
    .find(e => e.establishmentId === establishmentId && e.status === 'waiting' && e.partySize <= capacity);
  if (!next) return null;
  notifyParty(next.id, table.label);
  return next;
}
