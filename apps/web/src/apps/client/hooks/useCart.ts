import { usePublicMenu, type PricedMenuItem } from '@/services/restaurantService';
import { useClient } from '../clientContext';

/**
 * Carrinho precificado com o cardápio atual do servidor (ficha 08): promoção vigente e
 * disponibilidade em tempo real. Item que saiu do cardápio aparece como esgotado e bloqueia
 * o pedido até ser removido (ficha 19). As linhas seguem a ordem do carrinho (índices iguais).
 */
export function useCartSummary() {
  const { cart, cartEstablishmentId } = useClient();
  const menu = usePublicMenu(cartEstablishmentId).data?.items;
  const lines = cart.map(line => {
    const item: PricedMenuItem = menu?.find(i => i.id === line.itemId) ?? {
      id: line.itemId,
      name: line.name,
      description: '',
      category: '',
      image: line.image,
      price: 0,
      finalPrice: 0,
      available: menu === undefined,
      promotion: null,
      topSeller: false,
    };
    return { ...line, item };
  });
  const available = lines.filter(line => line.item.available);
  const subtotal = available.reduce((sum, line) => sum + line.item.price * line.quantity, 0);
  const total = available.reduce((sum, line) => sum + line.item.finalPrice * line.quantity, 0);
  return {
    lines,
    subtotal,
    discount: subtotal - total,
    total,
    hasUnavailable: lines.some(line => !line.item.available),
    count: available.reduce((sum, line) => sum + line.quantity, 0),
  };
}
