import { useQuery } from '@tanstack/react-query';
import {
  REALTIME_EVENTS,
  type AppNotificationsDto,
  type BookingDto,
  type BookingSlotsDto,
  type CashbackDto,
  type CouponValidationDto,
  type CreateBookingRequest,
  type CreateReviewRequest,
  type MeResponse,
  type MyReviewDto,
  type RestaurantReviewsDto,
  type SavePaymentMethodRequest,
  type SavedPaymentMethodDto,
  type ShareSource,
} from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { useUserRealtime } from '@/lib/realtime';
import { meQueryKey } from './authService';
import { ordersKey } from './orderService';

// Sprint 4 (cliente): cashback (15), reservas (30), avaliações (48), cartões salvos (49), cupom (56),
// compartilhar (62), alergias (64) e avisos in-app. Regras e cálculos são do servidor.

// ─── Cashback e cupom ───────────────────────────────────────────────────────

export function useCashback(enabled: boolean) {
  useUserRealtime([REALTIME_EVENTS.cashbackUpdated, REALTIME_EVENTS.orderUpdated], () => void queryClient.invalidateQueries({ queryKey: ['cashback'] }), enabled);
  return useQuery({ queryKey: ['cashback'], enabled, queryFn: ({ signal }) => api.get<CashbackDto>('/me/cashback', { limit: 50 }, signal) });
}

export function useRestaurantCashback(establishmentId: string | null | undefined) {
  return useQuery({
    queryKey: ['restaurants', 'cashback', establishmentId],
    enabled: Boolean(establishmentId),
    queryFn: ({ signal }) => api.get<{ name: string; percent: number; promotionName: string | null }[]>(`/restaurants/${establishmentId}/cashback`, undefined, signal),
  });
}

/** Confere o cupom no servidor para o carrinho atual; o erro traz a mensagem clara para o cliente. */
export const validateCoupon = (input: { establishmentId: string; code: string; subtotalCents: number }) => api.post<CouponValidationDto>('/coupons/validate', input);

// ─── Cartões salvos ─────────────────────────────────────────────────────────

const methodsKey = ['me', 'payment-methods'] as const;
const refreshMethods = () => queryClient.invalidateQueries({ queryKey: methodsKey });

export const usePaymentMethods = (enabled: boolean) => useQuery({ queryKey: methodsKey, enabled, queryFn: ({ signal }) => api.get<SavedPaymentMethodDto[]>('/me/payment-methods', undefined, signal) });
export const savePaymentMethod = (input: SavePaymentMethodRequest) => api.post<SavedPaymentMethodDto>('/me/payment-methods', input).finally(refreshMethods);
export const setDefaultPaymentMethod = (id: string) => api.put<SavedPaymentMethodDto>(`/me/payment-methods/${id}/default`).finally(refreshMethods);
export const removePaymentMethod = (id: string) => api.delete(`/me/payment-methods/${id}`).finally(refreshMethods);

// ─── Alergias e restrições ──────────────────────────────────────────────────

export async function updateDietaryRestrictions(dietaryRestrictions: string[]) {
  const me = await api.patch<MeResponse>('/me', { dietaryRestrictions });
  queryClient.setQueryData(meQueryKey, me);
  return me;
}

// ─── Avaliações ─────────────────────────────────────────────────────────────

export const useRestaurantReviews = (establishmentId: string | null | undefined) =>
  useQuery({ queryKey: ['restaurants', 'reviews', establishmentId], enabled: Boolean(establishmentId), queryFn: ({ signal }) => api.get<RestaurantReviewsDto>(`/restaurants/${establishmentId}/reviews`, { limit: 10 }, signal) });

export async function reviewOrder(orderId: string, input: CreateReviewRequest) {
  try {
    return await api.post<MyReviewDto>(`/orders/${orderId}/review`, input);
  } finally {
    void queryClient.invalidateQueries({ queryKey: ordersKey });
    void queryClient.invalidateQueries({ queryKey: ['restaurants'] });
  }
}

// ─── Reservas de mesa ───────────────────────────────────────────────────────

export function useBookingSlots(establishmentId: string | null, date: string, partySize: number) {
  return useQuery({
    queryKey: ['booking-slots', establishmentId, date, partySize],
    enabled: Boolean(establishmentId && date),
    queryFn: ({ signal }) => api.get<BookingSlotsDto>(`/restaurants/${establishmentId}/booking-slots`, { date, partySize }, signal),
  });
}

export function useMyBookings(enabled: boolean) {
  useUserRealtime([REALTIME_EVENTS.bookingsUpdated], () => void queryClient.invalidateQueries({ queryKey: ['my-bookings'] }), enabled);
  return useQuery({ queryKey: ['my-bookings'], enabled, queryFn: ({ signal }) => api.get<BookingDto[]>('/me/bookings', undefined, signal) });
}

export async function createBooking(input: CreateBookingRequest) {
  try {
    return await api.post<BookingDto>('/bookings', input);
  } finally {
    void queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
    void queryClient.invalidateQueries({ queryKey: ['booking-slots'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }
}

export const cancelMyBooking = (id: string) =>
  api.post<BookingDto>(`/bookings/${id}/cancel`).finally(() => {
    void queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
    void queryClient.invalidateQueries({ queryKey: ['booking-slots'] });
  });

// ─── Compartilhar restaurante ───────────────────────────────────────────────

/** Parâmetros do link compartilhado: `/?r=<restaurante>&src=<origem>` abre a página do restaurante no navegador. */
export const SHARE_LINK_PARAM = 'r';
export const SHARE_SOURCE_PARAM = 'src';

/** Link público da página do restaurante (abre no navegador, sem precisar do app). `src` registra a origem. */
export const restaurantShareUrl = (establishmentId: string, source: ShareSource) => `${window.location.origin}/?${SHARE_LINK_PARAM}=${establishmentId}&${SHARE_SOURCE_PARAM}=${source}`;

/** Registra o acesso pelo link compartilhado (métricas de marketing); falhar nunca atrapalha quem abriu o link. */
export const recordShareVisit = (establishmentId: string, source: string) => api.post(`/restaurants/${establishmentId}/share-visits`, { source }).catch(() => undefined);

// ─── Avisos in-app ──────────────────────────────────────────────────────────

export function useNotifications(enabled: boolean) {
  useUserRealtime([REALTIME_EVENTS.notificationsUpdated], () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }), enabled);
  return useQuery({ queryKey: ['notifications'], enabled, queryFn: ({ signal }) => api.get<AppNotificationsDto>('/me/notifications', undefined, signal) });
}

export const markNotificationsRead = (ids?: string[]) => api.post('/me/notifications/read', ids ? { ids } : {}).finally(() => void queryClient.invalidateQueries({ queryKey: ['notifications'] }));
