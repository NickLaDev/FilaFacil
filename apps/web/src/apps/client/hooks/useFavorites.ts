import { toggleFavorite, useFavoriteIds } from '@/services/accountExtrasService';
import { useClient } from '../clientContext';

/** Favoritos da conta (ficha 45, Sprint 2 — guardados no navegador até ganharem API). */
export function useFavorites() {
  const { account, showToast } = useClient();
  const favoriteIds = useFavoriteIds(account?.id ?? null);

  function toggle(establishmentId: string) {
    if (!account) {
      showToast('Entre na sua conta para salvar favoritos');
      return;
    }
    const removing = favoriteIds.has(establishmentId);
    toggleFavorite(account.id, establishmentId);
    showToast(removing ? 'Removido dos favoritos' : 'Adicionado aos favoritos');
  }

  return { favoriteIds, toggle, canFavorite: Boolean(account) };
}
