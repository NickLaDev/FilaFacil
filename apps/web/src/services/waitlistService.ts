import { useQuery, useQueryClient } from '@tanstack/react-query';
import { REALTIME_EVENTS, type ReleaseTablesResponse, type WaitlistDto, type WaitlistEntryDto } from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { useRealtime } from '@/lib/realtime';
import { clearLocalTableStates } from './floorService';
import { staffKeys } from './staffKeys';

const base = (establishmentId: string) => `/establishments/${establishmentId}/waitlist`;

function refresh(establishmentId: string) {
  void queryClient.invalidateQueries({ queryKey: staffKeys.waitlist(establishmentId) });
}

/** Ficha 21: fila com posição e estimativa calculadas no servidor, sincronizada entre aparelhos. */
export function useWaitlist(establishmentId: string) {
  const client = useQueryClient();
  useRealtime({ establishmentId }, [REALTIME_EVENTS.waitlistUpdated, REALTIME_EVENTS.floorPlanUpdated], () => {
    void client.invalidateQueries({ queryKey: staffKeys.waitlist(establishmentId) });
  });
  return useQuery({ queryKey: staffKeys.waitlist(establishmentId), queryFn: ({ signal }) => api.get<WaitlistDto>(base(establishmentId), undefined, signal) });
}

export async function addToWaitlist(establishmentId: string, input: { name: string; phone: string; partySize: number }) {
  try {
    return await api.post<WaitlistEntryDto>(base(establishmentId), input);
  } finally {
    refresh(establishmentId);
  }
}

export async function moveInWaitlist(establishmentId: string, entryId: string, position: number) {
  const list = await api.patch<WaitlistDto>(`${base(establishmentId)}/${entryId}/position`, { position });
  queryClient.setQueryData(staffKeys.waitlist(establishmentId), list);
  return list;
}

export async function notifyParty(establishmentId: string, entryId: string) {
  try {
    return await api.post<WaitlistEntryDto>(`${base(establishmentId)}/${entryId}/notify`);
  } finally {
    refresh(establishmentId);
  }
}

export async function seatParty(establishmentId: string, entryId: string) {
  try {
    await api.post(`${base(establishmentId)}/${entryId}/seat`);
  } finally {
    refresh(establishmentId);
    void queryClient.invalidateQueries({ queryKey: staffKeys.floor(establishmentId) });
  }
}

export async function removeFromWaitlist(establishmentId: string, entryId: string) {
  try {
    await api.delete(`${base(establishmentId)}/${entryId}`);
  } finally {
    refresh(establishmentId);
  }
}

/** Libera mesa(s) e o servidor avisa na hora o primeiro grupo da fila que cabe nelas. */
export async function releaseTables(establishmentId: string, tableIds: string[]) {
  try {
    const result = await api.post<ReleaseTablesResponse>(`/establishments/${establishmentId}/floor-plan/tables/release`, { tableIds });
    clearLocalTableStates(tableIds);
    return result.notifiedEntry;
  } finally {
    refresh(establishmentId);
    void queryClient.invalidateQueries({ queryKey: staffKeys.floor(establishmentId) });
  }
}
