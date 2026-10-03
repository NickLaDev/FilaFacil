import { useNow } from '@/lib/hooks';
import { usePricedMenu } from '@/services/menuService';
import { useClient } from '../clientContext';

/** Carrinho precificado com o cardápio atual: promoção e disponibilidade sempre em tempo real (ficha 08). */
export function useCartSummary() {
  const { cart, cartEstablishmentId } = useClient();
  const now = useNow(30_000);
  const menu = usePricedMenu(cartEstablishmentId ?? '', now);
  const lines = cart.flatMap(line => {
    const item = menu.find(i => i.id === line.itemId);
    return item ? [{ ...line, item }] : [];
  });
  const subtotal = lines.reduce((sum, line) => sum + line.item.price * line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + line.item.finalPrice * line.quantity, 0);
  return {
    lines,
    subtotal,
    discount: subtotal - total,
    total,
    hasUnavailable: lines.some(line => !line.item.available),
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}
