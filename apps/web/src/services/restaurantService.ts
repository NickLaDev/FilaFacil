import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ESTABLISHMENT_TYPE_LABELS,
  REALTIME_EVENTS,
  type Page,
  type PublicMenu,
  type PublicMenuItem,
  type RestaurantDetail,
  type RestaurantSummary,
} from '@filafacil/shared';
import { api, isApiError } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { useRealtime } from '@/lib/realtime';
import { useClientLocation } from './deviceService';

/** Restaurante como as telas do cliente exibem (dados da API + rótulos prontos). */
export interface Restaurant extends RestaurantSummary {
  typeLabel: string;
  /** Faixa exibida no card (ex.: "12–17 min"). */
  avgTime: string;
  highDemand: boolean;
}

export interface RestaurantDetailView extends Restaurant {
  timezone: string;
  openingHours: RestaurantDetail['openingHours'];
  reservationsOpen: boolean;
}

/** Item do cardápio público com preços em reais para exibição (o cálculo é do servidor). */
export interface PricedMenuItem {
  id: string;
  name: string;
  description: string;
  category: string;
  image: string | null;
  price: number;
  finalPrice: number;
  available: boolean;
  promotion: { id: string; name: string; discountPercent: number; endsAt: string } | null;
  /** Ficha 46: mais vendido nos últimos 30 dias ou destaque manual do gestor (selo "+ pedido"). */
  topSeller: boolean;
}

export interface RestaurantSearch {
  lat: number;
  lng: number;
  openNow?: boolean;
  sort?: 'distance' | 'wait' | 'name';
  /** Ficha 60: várias categorias de comida (basta o local ter uma); filtro feito no servidor. */
  categories?: string[];
}

const WAIT_RANGE_MINUTES = 5;
/** Busca próxima: o raio cobre a cidade e o resultado já vem ordenado pelo servidor. */
const SEARCH_RADIUS_KM = 30;
const SEARCH_PAGE_SIZE = 100;

export function toRestaurant(summary: RestaurantSummary): Restaurant {
  return {
    ...summary,
    typeLabel: ESTABLISHMENT_TYPE_LABELS[summary.type],
    avgTime: `${summary.averageWaitMinutes}–${summary.averageWaitMinutes + WAIT_RANGE_MINUTES} min`,
    highDemand: summary.orderingStatus === 'busy',
  };
}

export const toPricedItem = (item: PublicMenuItem & { isTopOrdered?: boolean; isHighlighted?: boolean }): PricedMenuItem => ({
  id: item.id,
  name: item.name,
  description: item.description,
  category: item.category,
  image: item.imageUrl,
  price: item.priceCents / 100,
  finalPrice: item.finalPriceCents / 100,
  available: true,
  promotion: item.promotion,
  topSeller: Boolean(item.isTopOrdered || item.isHighlighted),
});

export const restaurantKeys = {
  all: ['restaurants'] as const,
  search: (search: RestaurantSearch) => ['restaurants', 'search', search] as const,
  detail: (id: string) => ['restaurants', 'detail', id] as const,
  menu: (id: string) => ['restaurants', 'menu', id] as const,
};

/** Ficha 11: estabelecimentos próximos ordenados por distância (filtros "aberto agora" e "menor espera" no servidor). */
export function useRestaurants(search: RestaurantSearch | null) {
  return useQuery({
    queryKey: restaurantKeys.search(search ?? { lat: 0, lng: 0 }),
    enabled: search !== null,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const page = await api.get<Page<RestaurantSummary>>(
        '/restaurants',
        { lat: search?.lat, lng: search?.lng, openNow: search?.openNow, sort: search?.sort, categories: search?.categories?.length ? search.categories.join(',') : undefined, radiusKm: SEARCH_RADIUS_KM, pageSize: SEARCH_PAGE_SIZE },
        signal,
      );
      return page.items.map(toRestaurant);
    },
  });
}

/** Ficha 60: categorias de comida cadastradas (independem do filtro aplicado). */
export function useFoodCategories() {
  return useQuery({
    queryKey: ['restaurants', 'categories'],
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => (await api.get<{ categories: string[] }>('/restaurants/categories', undefined, signal)).categories,
  });
}

/** Ficha 12: página do restaurante. Inativo/suspenso responde 404 e a tela mostra indisponível. */
export function useRestaurant(id: string | null | undefined) {
  const queryClient = useQueryClient();
  useRealtime(id ? { restaurantId: id } : null, [REALTIME_EVENTS.restaurantUpdated], () => {
    if (id) void queryClient.invalidateQueries({ queryKey: restaurantKeys.detail(id) });
  });
  return useQuery({
    queryKey: restaurantKeys.detail(id ?? ''),
    enabled: Boolean(id),
    queryFn: ({ signal }) => fetchDetail(id as string, signal),
    // Indisponível (inativo/suspenso) é resposta definitiva: a tela mostra o aviso.
    retry: false,
  });
}

async function fetchDetail(id: string, signal?: AbortSignal): Promise<RestaurantDetailView> {
  const detail = await api.get<RestaurantDetail>(`/restaurants/${id}`, undefined, signal);
  return { ...toRestaurant(detail), timezone: detail.timezone, openingHours: detail.openingHours, reservationsOpen: detail.reservationsOpen };
}

/**
 * Fichas 03, 19 e 29: cardápio com preço vigente calculado pelo servidor. Mudanças de
 * disponibilidade, itens e promoções chegam por WebSocket e recarregam o cardápio na hora.
 */
export function usePublicMenu(id: string | null | undefined) {
  const queryClient = useQueryClient();
  useRealtime(id ? { restaurantId: id } : null, [REALTIME_EVENTS.menuUpdated], () => {
    if (id) void queryClient.invalidateQueries({ queryKey: restaurantKeys.menu(id) });
  });
  return useQuery({
    queryKey: restaurantKeys.menu(id ?? ''),
    enabled: Boolean(id),
    // Rede de segurança caso o WebSocket esteja bloqueado: a ficha 28 pede reflexo em até 1 minuto.
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      const menu = await api.get<PublicMenu>(`/restaurants/${id}/menu`, undefined, signal);
      return { categories: menu.categories.map(category => category.name), items: menu.items.map(toPricedItem) };
    },
  });
}

/** Atalho para telas que só precisam dos dados já carregados (null enquanto carrega ou se indisponível). */
export const useRestaurantData = (id: string | null | undefined) => useRestaurant(id).data ?? null;

/** Busca pontual (ex.: leitura do QR Code); null quando o restaurante não está disponível ao cliente. */
export async function fetchRestaurant(id: string) {
  try {
    return await queryClient.fetchQuery({ queryKey: restaurantKeys.detail(id), queryFn: () => fetchDetail(id), staleTime: 0 });
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null;
    throw error;
  }
}

/** Estabelecimentos perto da localização escolhida pelo cliente (GPS ou região). */
export function useNearbyRestaurants(options: Pick<RestaurantSearch, 'openNow' | 'sort' | 'categories'> = {}) {
  const { coords } = useClientLocation();
  return useRestaurants({ lat: coords.lat, lng: coords.lng, ...options });
}

/** Ficha 16: o cliente na mesa chama o atendente; o mapa do atendente destaca a mesa em tempo real. */
export const callAttendant = (tableId: string) => api.post<{ id: string; tableId: string; createdAt: string }>('/table-calls', { tableId });
