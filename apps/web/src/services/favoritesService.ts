import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RestaurantSummary } from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { toRestaurant, type Restaurant } from './restaurantService';

/** Ficha 45: favoritos ficam na conta (servidor), então acompanham o cliente em qualquer aparelho. */
export const favoritesKey = ['favorites'] as const;

export function useFavoriteRestaurants(enabled: boolean) {
  return useQuery({
    queryKey: favoritesKey,
    enabled,
    queryFn: async ({ signal }): Promise<Restaurant[]> => (await api.get<{ items: RestaurantSummary[] }>('/me/favorites', undefined, signal)).items.map(toRestaurant),
  });
}

/** Alterna o favorito com atualização imediata (<1 s); desfaz se o servidor recusar. */
export function useToggleFavorite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, add }: { id: string; add: boolean; restaurant?: Restaurant }) =>
      add ? api.put(`/me/favorites/${id}`) : api.delete(`/me/favorites/${id}`),
    onMutate: async ({ id, add, restaurant }) => {
      await client.cancelQueries({ queryKey: favoritesKey });
      const previous = client.getQueryData<Restaurant[]>(favoritesKey);
      client.setQueryData<Restaurant[]>(favoritesKey, current => {
        const list = current ?? [];
        if (!add) return list.filter(r => r.id !== id);
        return restaurant && !list.some(r => r.id === id) ? [...list, restaurant] : list;
      });
      return { previous };
    },
    onError: (_error, _vars, context) => client.setQueryData(favoritesKey, context?.previous),
    onSettled: () => void client.invalidateQueries({ queryKey: favoritesKey }),
  });
}

export const useFavoriteIdSet = (list: Restaurant[] | undefined) => useMemo(() => new Set((list ?? []).map(r => r.id)), [list]);
