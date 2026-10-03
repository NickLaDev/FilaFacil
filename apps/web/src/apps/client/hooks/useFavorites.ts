import { useMemo } from 'react';
import { toggleFavorite } from '@/services/authService';
import { useClient } from '../clientContext';

/** Favoritos ficam na conta; visitante é convidado a entrar (ficha 45). */
export function useFavorites() {
  const { account, showToast } = useClient();
  const favoriteIds = useMemo(() => new Set(account?.favoriteEstablishmentIds ?? []), [account]);

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
