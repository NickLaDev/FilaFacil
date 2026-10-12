import { errorMessage } from '@/lib/api/client';
import { useFavoriteIdSet, useFavoriteRestaurants, useToggleFavorite } from '@/services/favoritesService';
import type { Restaurant } from '@/services/restaurantService';
import { useClient } from '../clientContext';

/** Favoritos da conta, sincronizados com o servidor (ficha 45). */
export function useFavorites() {
  const { account, showToast } = useClient();
  const query = useFavoriteRestaurants(Boolean(account));
  const favoriteIds = useFavoriteIdSet(account ? query.data : undefined);
  const mutation = useToggleFavorite();

  function toggle(establishmentId: string, restaurant?: Restaurant) {
    if (!account) {
      showToast('Entre na sua conta para salvar favoritos');
      return;
    }
    const add = !favoriteIds.has(establishmentId);
    mutation.mutate(
      { id: establishmentId, add, restaurant },
      {
        onSuccess: () => showToast(add ? 'Adicionado aos favoritos' : 'Removido dos favoritos'),
        onError: error => showToast(errorMessage(error, 'Não foi possível atualizar os favoritos')),
      },
    );
  }

  return { favorites: query.data ?? [], favoriteIds, toggle, canFavorite: Boolean(account), isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}
