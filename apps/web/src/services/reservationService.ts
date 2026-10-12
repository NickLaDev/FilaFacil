import { useQuery } from '@tanstack/react-query';
import type { MyReservationDto, MyReservationsDto, MyReservationStateDto } from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';

const path = (restaurantId: string) => `/restaurants/${restaurantId}/reservation`;
const key = (restaurantId: string) => ['reservation', restaurantId] as const;
const REFRESH_MS = 15_000;

/** Ficha 12: reserva do cliente (entrada na fila de espera); a posição é reconsultada a cada 15 s. */
export function useMyReservation(restaurantId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: key(restaurantId ?? ''),
    enabled: enabled && Boolean(restaurantId),
    refetchInterval: REFRESH_MS,
    queryFn: ({ signal }) => api.get<MyReservationStateDto>(path(restaurantId as string), undefined, signal),
  });
}

export async function reserveTable(restaurantId: string, input: { partySize: number; phone?: string }) {
  try {
    return await api.post<MyReservationDto>(path(restaurantId), input);
  } finally {
    void queryClient.invalidateQueries({ queryKey: ['reservation'] });
  }
}

export async function cancelReservation(restaurantId: string) {
  try {
    await api.delete(path(restaurantId));
  } finally {
    void queryClient.invalidateQueries({ queryKey: ['reservation'] });
  }
}

/** Ficha 13: "Minhas reservas" (ativas, em todos os restaurantes). */
export function useMyReservations(enabled: boolean) {
  return useQuery({
    queryKey: ['reservation', 'mine'] as const,
    enabled,
    refetchInterval: REFRESH_MS,
    queryFn: ({ signal }) => api.get<MyReservationsDto>('/me/reservations', undefined, signal),
  });
}
