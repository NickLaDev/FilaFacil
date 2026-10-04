import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { REALTIME_EVENTS, type AvailabilityChangeDto, type ManagedMenuItem, type MenuCategoryDto, type Page } from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { useRealtime } from '@/lib/realtime';
import { createPersistentStore, useStore } from '@/lib/store';
import { restaurantKeys } from './restaurantService';
import { staffKeys } from './staffKeys';
import { useItemOrderCounts } from './orderService';

/** Item como os painéis exibem (preço em reais só para exibição; a API trabalha em centavos). */
export interface MenuItemView {
  id: string;
  name: string;
  description: string;
  category: string;
  categoryId: string;
  price: number;
  priceCents: number;
  image: string | null;
  available: boolean;
}

const toView = (item: ManagedMenuItem): MenuItemView => ({
  id: item.id,
  name: item.name,
  description: item.description,
  category: item.category,
  categoryId: item.categoryId,
  price: item.priceCents / 100,
  priceCents: item.priceCents,
  image: item.imageUrl,
  available: item.available,
});

/** Ordem padrão das categorias conhecidas quando a casa ainda não definiu outra. */
const CATEGORY_ORDER = ['Cervejas', 'Drinks', 'Porções', 'Lanches', 'Combos'];

export function sortCategories(categories: Iterable<string>) {
  const rank = (category: string) => {
    const index = CATEGORY_ORDER.indexOf(category);
    return index === -1 ? CATEGORY_ORDER.length : index;
  };
  return [...new Set(categories)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export const getCategories = (items: { category: string }[]) => [...new Set(items.map(item => item.category))];

function refreshMenu(establishmentId: string) {
  void queryClient.invalidateQueries({ queryKey: staffKeys.menu(establishmentId) });
  void queryClient.invalidateQueries({ queryKey: staffKeys.categories(establishmentId) });
  void queryClient.invalidateQueries({ queryKey: restaurantKeys.menu(establishmentId) });
}

/** Cardápio completo da equipe (inclui esgotados), atualizado em tempo real entre gestor e atendentes. */
export function useMenuItems(establishmentId: string) {
  const client = useQueryClient();
  useRealtime({ establishmentId }, [REALTIME_EVENTS.menuUpdated], () => {
    void client.invalidateQueries({ queryKey: staffKeys.menu(establishmentId) });
    void client.invalidateQueries({ queryKey: staffKeys.availabilityHistory(establishmentId) });
  });
  return useQuery({
    queryKey: staffKeys.menu(establishmentId),
    queryFn: async ({ signal }) => (await api.get<ManagedMenuItem[]>(`/establishments/${establishmentId}/menu/items`, undefined, signal)).map(toView),
  });
}

export function useMenuCategories(establishmentId: string) {
  return useQuery({
    queryKey: staffKeys.categories(establishmentId),
    queryFn: ({ signal }) => api.get<MenuCategoryDto[]>(`/establishments/${establishmentId}/menu/categories`, undefined, signal),
  });
}

export interface MenuItemInput {
  name: string;
  description: string;
  categoryName: string;
  priceCents: number;
  available: boolean;
  /** Link https externo; foto enviada do computador vai por uploadMenuItemPhoto. */
  imageUrl?: string;
}

export async function saveMenuItem(establishmentId: string, input: MenuItemInput, id?: string) {
  const base = `/establishments/${establishmentId}/menu/items`;
  try {
    return id ? await api.patch<ManagedMenuItem>(`${base}/${id}`, input) : await api.post<ManagedMenuItem>(base, input);
  } finally {
    refreshMenu(establishmentId);
  }
}

export async function uploadMenuItemPhoto(establishmentId: string, itemId: string, file: File) {
  try {
    return await api.upload<ManagedMenuItem>(`/establishments/${establishmentId}/menu/items/${itemId}/photo`, file);
  } finally {
    refreshMenu(establishmentId);
  }
}

export async function deleteMenuItem(establishmentId: string, itemId: string) {
  try {
    await api.delete(`/establishments/${establishmentId}/menu/items/${itemId}`);
  } finally {
    refreshMenu(establishmentId);
    void queryClient.invalidateQueries({ queryKey: staffKeys.promotions(establishmentId) });
  }
}

/** Ficha 19: some/volta no cardápio do cliente em segundos; o servidor registra quem alterou. */
export async function setItemAvailability(establishmentId: string, itemId: string, available: boolean) {
  try {
    return await api.patch<ManagedMenuItem>(`/establishments/${establishmentId}/menu/items/${itemId}/availability`, { available });
  } finally {
    refreshMenu(establishmentId);
    void queryClient.invalidateQueries({ queryKey: staffKeys.availabilityHistory(establishmentId) });
  }
}

export function useAvailabilityLog(establishmentId: string, pageSize = 50) {
  return useQuery({
    queryKey: [...staffKeys.availabilityHistory(establishmentId), pageSize],
    queryFn: ({ signal }) =>
      api.get<Page<AvailabilityChangeDto>>(`/establishments/${establishmentId}/menu/availability-history`, { pageSize }, signal),
  });
}

// ─── Selo "+ pedido" (ficha 46, Sprint 2 — ainda local) ─────────────────────

/** Quantos itens recebem o selo pelo ranking de vendas. */
const POPULAR_RANKING_SIZE = 3;
const featuredStore = createPersistentStore<string[]>('featured-items', []);

export const useFeaturedIds = () => new Set(useStore(featuredStore));

export function toggleFeatured(itemId: string) {
  featuredStore.set(prev => (prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]));
}

/** Destaque manual do gestor ou top 3 em pedidos dos últimos 30 dias (pedidos ainda simulados). */
export function useHighlightedIds() {
  const featured = useStore(featuredStore);
  const counts = useItemOrderCounts();
  return useMemo(() => {
    const popular = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, POPULAR_RANKING_SIZE).map(([id]) => id);
    return new Set([...featured, ...popular]);
  }, [featured, counts]);
}
