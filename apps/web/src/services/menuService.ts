import { useQuery, useQueryClient } from '@tanstack/react-query';
import { REALTIME_EVENTS, type AvailabilityChangeDto, type ManagedMenuItem, type MenuCategoryDto, type MenuRankingDto, type Page } from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { useRealtime } from '@/lib/realtime';
import { restaurantKeys } from './restaurantService';
import { staffKeys } from './staffKeys';

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
  /** Ficha 46: destaque manual do gestor. */
  highlighted: boolean;
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
  highlighted: item.highlighted,
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

// ─── Selo "+ pedido" (ficha 46) ─────────────────────────────────────────────

export type MenuRanking = MenuRankingDto;

const rankingPath = (establishmentId: string) => `/establishments/${establishmentId}/menu/ranking`;

/** Ranking de vendas dos últimos 30 dias (recalculado toda semana pelo servidor) com os destaques manuais. */
export function useMenuRanking(establishmentId: string) {
  return useQuery({
    queryKey: staffKeys.ranking(establishmentId),
    queryFn: ({ signal }) => api.get<MenuRanking>(rankingPath(establishmentId), undefined, signal),
  });
}

/** Destaque manual do gestor: o selo aparece no cardápio do cliente na hora (menu.updated). */
export async function setItemHighlight(establishmentId: string, itemId: string, highlighted: boolean) {
  try {
    await api.put(`/establishments/${establishmentId}/menu/items/${itemId}/highlight`, { highlighted });
  } finally {
    void queryClient.invalidateQueries({ queryKey: staffKeys.ranking(establishmentId) });
    refreshMenu(establishmentId);
  }
}

export async function recalculateRanking(establishmentId: string) {
  const ranking = await api.post<MenuRanking>(`${rankingPath(establishmentId)}/recalculate`);
  queryClient.setQueryData(staffKeys.ranking(establishmentId), ranking);
  void queryClient.invalidateQueries({ queryKey: restaurantKeys.menu(establishmentId) });
  return ranking;
}
