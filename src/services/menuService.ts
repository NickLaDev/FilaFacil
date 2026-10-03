import { useMemo } from 'react';
import { createPersistentStore, useStore } from '@/lib/store';
import { createId } from '@/lib/utils';
import { AVAILABILITY_LOG, CATEGORY_ORDER, MENU_ITEMS, PROMOTIONS } from '@/data/catalog';
import type { AvailabilityLogEntry, MenuItem, Promotion, PromotionState } from '@/types/catalog';
import { useHasPlanFeature } from './planService';

const menuStore = createPersistentStore('menu-items', MENU_ITEMS);
const promotionsStore = createPersistentStore('promotions', PROMOTIONS);
const availabilityLogStore = createPersistentStore('availability-log', AVAILABILITY_LOG);

/** Quantos itens recebem o selo "+ pedido" pelo ranking de vendas (ficha 46). */
const POPULAR_RANKING_SIZE = 3;

// ─── Itens ──────────────────────────────────────────────────────────────────

export function useMenuItems(establishmentId: string) {
  const items = useStore(menuStore);
  return useMemo(() => items.filter(i => i.establishmentId === establishmentId), [items, establishmentId]);
}

export function sortCategories(categories: Iterable<string>) {
  const rank = (category: string) => {
    const index = CATEGORY_ORDER.indexOf(category);
    return index === -1 ? CATEGORY_ORDER.length : index;
  };
  return [...new Set(categories)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export const getCategories = (items: MenuItem[]) => sortCategories(items.map(i => i.category));

export function getPopularItemIds(items: MenuItem[]) {
  const ranked = [...items].sort((a, b) => b.orderCount30d - a.orderCount30d).slice(0, POPULAR_RANKING_SIZE);
  return new Set(ranked.map(i => i.id));
}

export type MenuItemInput = Pick<MenuItem, 'name' | 'description' | 'price' | 'category' | 'image' | 'available'>;

export function saveMenuItem(establishmentId: string, input: MenuItemInput, id?: string) {
  menuStore.set(prev =>
    id
      ? prev.map(i => (i.id === id ? { ...i, ...input } : i))
      : [...prev, { ...input, id: createId('item'), establishmentId, orderCount30d: 0, featured: false }],
  );
}

export function deleteMenuItem(id: string) {
  menuStore.set(prev => prev.filter(i => i.id !== id));
  promotionsStore.set(prev => prev.map(p => ({ ...p, itemIds: p.itemIds.filter(itemId => itemId !== id) })));
}

export function toggleFeatured(id: string) {
  menuStore.set(prev => prev.map(i => (i.id === id ? { ...i, featured: !i.featured } : i)));
}

/** Ficha 19: some/volta no cardápio do cliente na hora e registra quem alterou. */
export function setItemAvailability(id: string, available: boolean, actor: string) {
  const item = menuStore.get().find(i => i.id === id);
  if (!item || item.available === available) return;
  menuStore.set(prev => prev.map(i => (i.id === id ? { ...i, available } : i)));
  const entry: AvailabilityLogEntry = {
    id: createId('log'),
    establishmentId: item.establishmentId,
    itemId: id,
    itemName: item.name,
    available,
    actor,
    at: new Date().toISOString(),
  };
  availabilityLogStore.set(prev => [entry, ...prev]);
}

export function useAvailabilityLog(establishmentId: string) {
  const log = useStore(availabilityLogStore);
  return useMemo(() => log.filter(entry => entry.establishmentId === establishmentId), [log, establishmentId]);
}

// ─── Promoções ──────────────────────────────────────────────────────────────

export function usePromotions(establishmentId: string) {
  const promotions = useStore(promotionsStore);
  return useMemo(() => promotions.filter(p => p.establishmentId === establishmentId), [promotions, establishmentId]);
}

/** Ativação e encerramento são automáticos: derivados do período, sem ação manual (ficha 29). */
export function getPromotionState(promotion: Promotion, now: number): PromotionState {
  if (now < Date.parse(promotion.startsAt)) return 'scheduled';
  if (now > Date.parse(promotion.endsAt)) return 'expired';
  return 'active';
}

export type PromotionInput = Omit<Promotion, 'id' | 'establishmentId'>;

export function savePromotion(establishmentId: string, input: PromotionInput, id?: string) {
  promotionsStore.set(prev =>
    id ? prev.map(p => (p.id === id ? { ...p, ...input } : p)) : [...prev, { ...input, id: createId('promo'), establishmentId }],
  );
}

export function deletePromotion(id: string) {
  promotionsStore.set(prev => prev.filter(p => p.id !== id));
}

export const applyDiscount = (price: number, discountPercent: number) =>
  Math.round(price * (100 - discountPercent)) / 100;

export interface PricedMenuItem extends MenuItem {
  finalPrice: number;
  promotion: Promotion | null;
  highlighted: boolean;
}

/** Cardápio como o cliente vê: preço promocional vigente e selo "+ pedido". */
export function usePricedMenu(establishmentId: string, now: number): PricedMenuItem[] {
  const items = useMenuItems(establishmentId);
  const promotions = usePromotions(establishmentId);
  // Promoção só vale se o plano contratado inclui o recurso (ficha 37).
  const promotionsEnabled = useHasPlanFeature(establishmentId, 'promotions');
  return useMemo(() => {
    const popularIds = getPopularItemIds(items);
    const active = promotionsEnabled ? promotions.filter(p => getPromotionState(p, now) === 'active') : [];
    return items.map(item => {
      const promotion = active
        .filter(p => p.itemIds.includes(item.id))
        .reduce<Promotion | null>((best, p) => (!best || p.discountPercent > best.discountPercent ? p : best), null);
      return {
        ...item,
        promotion,
        finalPrice: promotion ? applyDiscount(item.price, promotion.discountPercent) : item.price,
        highlighted: item.featured || popularIds.has(item.id),
      };
    });
  }, [items, promotions, promotionsEnabled, now]);
}
