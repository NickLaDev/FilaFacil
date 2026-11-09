import { useQuery } from '@tanstack/react-query';
import {
  REALTIME_EVENTS,
  type AppNotificationsDto,
  type BillingRunDto,
  type BookingDto,
  type BookingStatus,
  type CashbackRuleDto,
  type CashbackRuleInput,
  type CostReportDto,
  type CouponDto,
  type CouponInput,
  type CreateSupportTicketRequest,
  type EstablishmentChangeDto,
  type ExpirySettingsDto,
  type IncidentDto,
  type IngredientLotDto,
  type IngredientLotInput,
  type IntegrationCreatedDto,
  type IntegrationKind,
  type InvoiceDto,
  type InvoicesPage,
  type InvoiceStatus,
  type MonitoringOverviewDto,
  type Page,
  type ShareVisitsDto,
  type SupportPriority,
  type SupportStatus,
  type SupportTicketDetailDto,
  type SupportTicketDto,
} from '@filafacil/shared';
import { API_BASE_URL, api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { isRealtimeHealthy, useRealtime, useUserRealtime } from '@/lib/realtime';
import { staffKeys } from './staffKeys';

// Sprint 4 (gestor e admin): reservas (30), cupons e cashback (15, 56), custo (57), validade (70), suporte (39),
// faturas (38), incidentes (33), histórico (66) e avisos da casa. Regras e cálculos são do servidor.

const base = (establishmentId: string) => `/establishments/${establishmentId}`;
const POLL_FALLBACK_MS = 8_000;
const key = (establishmentId: string, ...parts: (string | number | undefined)[]) => ['staff', establishmentId, ...parts] as const;
const invalidate = (establishmentId: string, ...parts: string[]) => void queryClient.invalidateQueries({ queryKey: key(establishmentId, ...parts) });

// ─── Reservas de mesa (30) ──────────────────────────────────────────────────

export function useStaffBookings(establishmentId: string, filter: { date?: string; status?: BookingStatus; includePast?: boolean }) {
  useRealtime({ establishmentId }, [REALTIME_EVENTS.bookingsUpdated], () => invalidate(establishmentId, 'bookings'));
  return useQuery({
    queryKey: key(establishmentId, 'bookings', filter.date, filter.status, String(filter.includePast ?? false)),
    queryFn: ({ signal }) => api.get<BookingDto[]>(`${base(establishmentId)}/bookings`, filter, signal),
    refetchInterval: () => (isRealtimeHealthy() ? false : POLL_FALLBACK_MS),
  });
}

export const cancelStaffBooking = (establishmentId: string, id: string) => api.post<BookingDto>(`${base(establishmentId)}/bookings/${id}/cancel`).finally(() => invalidate(establishmentId, 'bookings'));
export const seatStaffBooking = (establishmentId: string, id: string) => api.post<BookingDto>(`${base(establishmentId)}/bookings/${id}/seat`).finally(() => invalidate(establishmentId, 'bookings'));

// ─── Cupons e cashback (56, 15) ─────────────────────────────────────────────

export const useCoupons = (establishmentId: string) => useQuery({ queryKey: key(establishmentId, 'coupons'), queryFn: ({ signal }) => api.get<CouponDto[]>(`${base(establishmentId)}/coupons`, undefined, signal) });

export const saveCoupon = (establishmentId: string, input: CouponInput, id?: string) =>
  (id ? api.patch<CouponDto>(`${base(establishmentId)}/coupons/${id}`, input) : api.post<CouponDto>(`${base(establishmentId)}/coupons`, input)).finally(() => invalidate(establishmentId, 'coupons'));
export const deleteCoupon = (establishmentId: string, id: string) => api.delete(`${base(establishmentId)}/coupons/${id}`).finally(() => invalidate(establishmentId, 'coupons'));

export const useCashbackRules = (establishmentId: string) => useQuery({ queryKey: key(establishmentId, 'cashback-rules'), queryFn: ({ signal }) => api.get<CashbackRuleDto[]>(`${base(establishmentId)}/cashback-rules`, undefined, signal) });

export const saveCashbackRule = (establishmentId: string, input: CashbackRuleInput, id?: string) =>
  (id ? api.patch<CashbackRuleDto>(`${base(establishmentId)}/cashback-rules/${id}`, input) : api.post<CashbackRuleDto>(`${base(establishmentId)}/cashback-rules`, input)).finally(() => invalidate(establishmentId, 'cashback-rules'));
export const deleteCashbackRule = (establishmentId: string, id: string) => api.delete(`${base(establishmentId)}/cashback-rules/${id}`).finally(() => invalidate(establishmentId, 'cashback-rules'));

// ─── Relatório de custo (57) ────────────────────────────────────────────────

export const useCostReport = (establishmentId: string, from: string, to: string) =>
  useQuery({ queryKey: key(establishmentId, 'cost-report', from, to), enabled: Boolean(from && to && from <= to), queryFn: ({ signal }) => api.get<CostReportDto>(`${base(establishmentId)}/reports/cost`, { from, to }, signal) });

/** Link de download (CSV ou PDF): o navegador envia o cookie de sessão; o servidor valida a permissão. */
export const costReportExportUrl = (establishmentId: string, from: string, to: string, format: 'csv' | 'pdf') =>
  `${API_BASE_URL}${base(establishmentId)}/reports/cost/export?from=${from}&to=${to}&format=${format}`;

// ─── Validade de insumos (70) ───────────────────────────────────────────────

export function useIngredientLots(establishmentId: string) {
  useRealtime({ establishmentId }, [REALTIME_EVENTS.stockUpdated, REALTIME_EVENTS.alertsUpdated], () => invalidate(establishmentId, 'lots'));
  return useQuery({ queryKey: key(establishmentId, 'lots'), queryFn: ({ signal }) => api.get<IngredientLotDto[]>(`${base(establishmentId)}/ingredient-lots`, undefined, signal) });
}

const afterLot = (establishmentId: string) => {
  invalidate(establishmentId, 'lots');
  void queryClient.invalidateQueries({ queryKey: staffKeys.alerts(establishmentId) });
};
export const createIngredientLot = (establishmentId: string, input: IngredientLotInput) => api.post<IngredientLotDto>(`${base(establishmentId)}/ingredient-lots`, input).finally(() => afterLot(establishmentId));
export const closeIngredientLot = (establishmentId: string, id: string) => api.post<IngredientLotDto>(`${base(establishmentId)}/ingredient-lots/${id}/close`).finally(() => afterLot(establishmentId));
export const deleteIngredientLot = (establishmentId: string, id: string) => api.delete(`${base(establishmentId)}/ingredient-lots/${id}`).finally(() => afterLot(establishmentId));

export const useExpirySettings = (establishmentId: string) => useQuery({ queryKey: key(establishmentId, 'expiry-settings'), queryFn: ({ signal }) => api.get<ExpirySettingsDto>(`${base(establishmentId)}/expiry-settings`, undefined, signal) });
export const saveExpirySettings = (establishmentId: string, alertDays: number) =>
  api.put<ExpirySettingsDto>(`${base(establishmentId)}/expiry-settings`, { alertDays }).finally(() => {
    invalidate(establishmentId, 'expiry-settings');
    afterLot(establishmentId);
  });

// ─── Compartilhamento (62) ──────────────────────────────────────────────────

export const useShareVisits = (establishmentId: string) => useQuery({ queryKey: key(establishmentId, 'share-visits'), queryFn: ({ signal }) => api.get<ShareVisitsDto>(`${base(establishmentId)}/share-visits`, { days: 30 }, signal) });

// ─── Suporte, faturas e avisos da casa (39, 38) ─────────────────────────────

export function useEstablishmentTickets(establishmentId: string) {
  useRealtime({ establishmentId }, [REALTIME_EVENTS.supportUpdated], () => invalidate(establishmentId, 'tickets'));
  return useQuery({ queryKey: key(establishmentId, 'tickets'), queryFn: ({ signal }) => api.get<SupportTicketDto[]>(`${base(establishmentId)}/support/tickets`, undefined, signal) });
}

export const useEstablishmentTicket = (establishmentId: string, id: string | null) =>
  useQuery({ queryKey: key(establishmentId, 'tickets', id ?? ''), enabled: Boolean(id), queryFn: ({ signal }) => api.get<SupportTicketDetailDto>(`${base(establishmentId)}/support/tickets/${id}`, undefined, signal) });

const afterTicket = (establishmentId: string) => invalidate(establishmentId, 'tickets');
export const createSupportTicket = (establishmentId: string, input: CreateSupportTicketRequest) => api.post<SupportTicketDetailDto>(`${base(establishmentId)}/support/tickets`, input).finally(() => afterTicket(establishmentId));
export const replySupportTicket = (establishmentId: string, id: string, body: string) => api.post<SupportTicketDetailDto>(`${base(establishmentId)}/support/tickets/${id}/messages`, { body }).finally(() => afterTicket(establishmentId));
export const resolveSupportTicket = (establishmentId: string, id: string) => api.post<SupportTicketDetailDto>(`${base(establishmentId)}/support/tickets/${id}/resolve`).finally(() => afterTicket(establishmentId));

export const useEstablishmentInvoices = (establishmentId: string) => useQuery({ queryKey: key(establishmentId, 'invoices'), queryFn: ({ signal }) => api.get<InvoiceDto[]>(`${base(establishmentId)}/invoices`, undefined, signal) });

export function useStaffNotifications(establishmentId: string) {
  useRealtime({ establishmentId }, [REALTIME_EVENTS.notificationsUpdated], () => invalidate(establishmentId, 'notifications'));
  return useQuery({ queryKey: key(establishmentId, 'notifications'), queryFn: ({ signal }) => api.get<AppNotificationsDto>(`${base(establishmentId)}/notifications`, undefined, signal), refetchInterval: () => (isRealtimeHealthy() ? false : 30_000) });
}

export const markStaffNotificationsRead = (establishmentId: string, ids?: string[]) => api.post(`${base(establishmentId)}/notifications/read`, ids ? { ids } : {}).finally(() => invalidate(establishmentId, 'notifications'));

// ─── Admin: suporte (39) ────────────────────────────────────────────────────

export interface AdminTicketsFilter {
  scope: 'active' | 'resolved' | 'all';
  priority?: SupportPriority;
  q?: string;
}

export type AdminTicketsPage = Page<SupportTicketDto> & { counts: Record<SupportStatus | 'urgentOpen' | 'awaiting', number> };

export function useAdminTickets(filter: AdminTicketsFilter) {
  useUserRealtime([REALTIME_EVENTS.supportUpdated], () => void queryClient.invalidateQueries({ queryKey: ['admin', 'tickets'] }));
  return useQuery({
    queryKey: ['admin', 'tickets', filter],
    queryFn: ({ signal }) => api.get<AdminTicketsPage>('/admin/support/tickets', { ...filter, pageSize: 50 }, signal),
    // Meta: o chamado aparece na fila em até 1 minuto — o evento em tempo real chega na hora e a consulta é rede de segurança.
    refetchInterval: () => (isRealtimeHealthy() ? 30_000 : 10_000),
  });
}

export const useAdminTicket = (id: string | null) => useQuery({ queryKey: ['admin', 'tickets', 'detail', id], enabled: Boolean(id), queryFn: ({ signal }) => api.get<SupportTicketDetailDto>(`/admin/support/tickets/${id}`, undefined, signal), refetchInterval: () => (isRealtimeHealthy() ? 30_000 : 10_000) });

const afterAdminTicket = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'tickets'] });
export const replyAdminTicket = (id: string, body: string) => api.post<SupportTicketDetailDto>(`/admin/support/tickets/${id}/messages`, { body }).finally(afterAdminTicket);
export const updateAdminTicket = (id: string, changes: { status?: SupportStatus; priority?: SupportPriority }) => api.patch<SupportTicketDetailDto>(`/admin/support/tickets/${id}`, changes).finally(afterAdminTicket);

// ─── Admin: monitoramento (33) ──────────────────────────────────────────────

export function useMonitoring() {
  useUserRealtime([REALTIME_EVENTS.monitoringUpdated], () => void queryClient.invalidateQueries({ queryKey: ['admin', 'monitoring'] }));
  return useQuery({
    queryKey: ['admin', 'monitoring', 'overview'],
    queryFn: ({ signal }) => api.get<MonitoringOverviewDto>('/admin/monitoring', undefined, signal),
    // Meta: incidente no painel em até 1 minuto da queda — o evento chega na hora; a consulta é rede de segurança.
    refetchInterval: () => (isRealtimeHealthy() ? 20_000 : 5_000),
  });
}

export const useIncidentHistory = (page: number, active?: boolean) =>
  useQuery({ queryKey: ['admin', 'monitoring', 'incidents', page, active], queryFn: ({ signal }) => api.get<Page<IncidentDto>>('/admin/monitoring/incidents', { page, pageSize: 15, active }, signal) });

const afterMonitoring = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'monitoring'] });
export const createIntegration = (input: { establishmentId: string; name: string; kind: IntegrationKind }) => api.post<IntegrationCreatedDto>('/admin/monitoring/integrations', input).finally(afterMonitoring);
export const rotateIntegrationKey = (id: string) => api.post<IntegrationCreatedDto>(`/admin/monitoring/integrations/${id}/rotate-key`).finally(afterMonitoring);
export const deleteIntegration = (id: string) => api.delete(`/admin/monitoring/integrations/${id}`).finally(afterMonitoring);

// ─── Admin: faturas (38) ────────────────────────────────────────────────────

export interface AdminInvoicesFilter {
  status?: InvoiceStatus;
  q?: string;
  period?: string;
  page: number;
}

export const useAdminInvoices = (filter: AdminInvoicesFilter) =>
  useQuery({ queryKey: ['admin', 'invoices', filter], queryFn: ({ signal }) => api.get<InvoicesPage>('/admin/invoices', { ...filter, pageSize: 20 }, signal) });

const afterInvoice = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'invoices'] });
export const markInvoicePaid = (id: string, note?: string) => api.post<InvoiceDto>(`/admin/invoices/${id}/pay`, note ? { note } : {}).finally(afterInvoice);
export const cancelInvoice = (id: string) => api.post<InvoiceDto>(`/admin/invoices/${id}/cancel`).finally(afterInvoice);
export const runBilling = () => api.post<BillingRunDto>('/admin/billing/run').finally(afterInvoice);

// ─── Admin: histórico de alterações (66) ────────────────────────────────────

export interface ChangeLogFilter {
  establishmentId?: string;
  field?: string;
  q?: string;
  from?: string;
  to?: string;
  page: number;
}

export const useEstablishmentChanges = (filter: ChangeLogFilter) =>
  useQuery({ queryKey: ['admin', 'establishment-changes', filter], queryFn: ({ signal }) => api.get<Page<EstablishmentChangeDto>>('/admin/establishment-changes', { ...filter, pageSize: 20 }, signal) });
