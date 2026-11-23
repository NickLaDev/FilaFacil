import { useQuery } from '@tanstack/react-query';
import type {
  AccessLogDto,
  AuditLogDto,
  IntegrationDetailDto,
  MenuImportResultDto,
  MyOfferDto,
  OrganizationDetailDto,
  OrganizationReportDto,
  OrganizationRole,
  OrganizationSummaryDto,
  Page,
  PartnerApplicationCreatedDto,
  PartnerApplicationDto,
  PartnerApplicationInput,
  PartnerApplicationsPage,
  PartnerApplicationStatus,
  PlanChangeResultDto,
  PlanComparisonDto,
  PlatformMetricsDto,
  PlatformOverviewDto,
  PlatformSettingDto,
  PublicFeaturesDto,
  SegmentCampaignDto,
  SegmentCampaignInput,
  SettingImpactDto,
  UserAccessDto,
} from '@filafacil/shared';
import { API_BASE_URL, api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { staffKeys } from './staffKeys';

// Sprint 5: painel e métricas da plataforma (32, 41), organizações (35), integrações (40), auditoria (42),
// configurações (43), acessos (52), cardápio por planilha (54), parceiros (55), planos (58, 69) e campanhas (68).
// Regras e cálculos são do servidor; aqui só buscamos, enviamos e invalidamos o cache.

const invalidate = (...key: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey: key });
const REFRESH_MS = 30_000;

// ─── Plataforma: visão geral e métricas ─────────────────────────────────────

export const usePlatformOverview = () =>
  useQuery({ queryKey: ['admin', 'overview'], refetchInterval: REFRESH_MS, queryFn: ({ signal }) => api.get<PlatformOverviewDto>('/admin/overview', undefined, signal) });

export interface MetricsFilter {
  from: string;
  to: string;
  compareFrom?: string;
  compareTo?: string;
}

export const usePlatformMetrics = (filter: MetricsFilter) =>
  useQuery({
    queryKey: ['admin', 'metrics', filter],
    enabled: Boolean(filter.from && filter.to && filter.from <= filter.to),
    queryFn: ({ signal }) => api.get<PlatformMetricsDto>('/admin/metrics', { ...filter }, signal),
  });

export const metricsExportUrl = (filter: MetricsFilter, format: 'csv' | 'pdf') => {
  const params = new URLSearchParams({ from: filter.from, to: filter.to, format });
  if (filter.compareFrom && filter.compareTo) {
    params.set('compareFrom', filter.compareFrom);
    params.set('compareTo', filter.compareTo);
  }
  return `${API_BASE_URL}/admin/metrics/export?${params.toString()}`;
};

// ─── Organizações ───────────────────────────────────────────────────────────

export const useOrganizationsOverview = () => useQuery({ queryKey: ['admin', 'organizations-overview'], queryFn: ({ signal }) => api.get<OrganizationSummaryDto[]>('/admin/organizations/overview', undefined, signal) });

export const useOrganizationDetail = (id: string | null, from: string, to: string) =>
  useQuery({ queryKey: ['admin', 'organization', id, from, to], enabled: Boolean(id && from <= to), queryFn: ({ signal }) => api.get<OrganizationDetailDto>(`/admin/organizations/${id}`, { from, to }, signal) });

const refreshOrganizations = () => {
  invalidate('admin', 'organization');
  invalidate('admin', 'organizations-overview');
  invalidate('admin', 'establishments');
  invalidate('admin', 'overview');
};
export const renameOrganization = (id: string, name: string) => api.patch<OrganizationDetailDto>(`/admin/organizations/${id}`, { name }).finally(refreshOrganizations);
export const linkEstablishment = (id: string, establishmentId: string) => api.post<OrganizationDetailDto>(`/admin/organizations/${id}/establishments`, { establishmentId }).finally(refreshOrganizations);
export const setOrganizationMember = (id: string, userId: string, role: OrganizationRole) => api.put<OrganizationDetailDto>(`/admin/organizations/${id}/members/${userId}`, { role }).finally(refreshOrganizations);
export const removeOrganizationMember = (id: string, userId: string) => api.delete<OrganizationDetailDto>(`/admin/organizations/${id}/members/${userId}`).finally(refreshOrganizations);

/** Redes das quais o gestor faz parte (admin ou visualizador) e o relatório consolidado. */
export const useMyOrganizations = () => useQuery({ queryKey: ['organizations', 'mine'], queryFn: ({ signal }) => api.get<{ id: string; name: string; role: OrganizationRole }[]>('/organizations/mine', undefined, signal) });
export const useOrganizationReport = (id: string | null, from: string, to: string) =>
  useQuery({ queryKey: ['organizations', 'report', id, from, to], enabled: Boolean(id && from <= to), queryFn: ({ signal }) => api.get<OrganizationReportDto>(`/organizations/${id}/report`, { from, to }, signal) });

// ─── Integrações (detalhe, ativar e testar) ─────────────────────────────────

export const useIntegrationDetail = (id: string | null) =>
  useQuery({ queryKey: ['admin', 'integration', id], enabled: Boolean(id), refetchInterval: 15_000, queryFn: ({ signal }) => api.get<IntegrationDetailDto>(`/admin/monitoring/integrations/${id}`, undefined, signal) });

const refreshMonitoring = () => {
  invalidate('admin', 'monitoring');
  invalidate('admin', 'integration');
  invalidate('admin', 'incidents');
};
export const updateIntegration = (id: string, input: { enabled?: boolean; healthUrl?: string | null; name?: string }) => api.patch<IntegrationDetailDto>(`/admin/monitoring/integrations/${id}`, input).finally(refreshMonitoring);
export const testIntegration = (id: string) => api.post<IntegrationDetailDto>(`/admin/monitoring/integrations/${id}/test`).finally(refreshMonitoring);

// ─── Auditoria e acessos ────────────────────────────────────────────────────

export interface AuditFilter {
  page: number;
  action?: string;
  actorId?: string;
  q?: string;
  from?: string;
  to?: string;
}

export const useAuditLog = (filter: AuditFilter) =>
  useQuery({ queryKey: ['admin', 'audit', filter], refetchInterval: REFRESH_MS, queryFn: ({ signal }) => api.get<Page<AuditLogDto>>('/admin/audit', { ...filter, pageSize: 20 }, signal) });

export const useAccessLogs = (page: number, newDevice: boolean) =>
  useQuery({ queryKey: ['admin', 'access-logs', page, newDevice], refetchInterval: REFRESH_MS, queryFn: ({ signal }) => api.get<Page<AccessLogDto>>('/admin/access-logs', { page, pageSize: 20, newDevice: newDevice || undefined }, signal) });

export const useUserAccess = (userId: string | null) =>
  useQuery({ queryKey: ['admin', 'user-access', userId], enabled: Boolean(userId), queryFn: ({ signal }) => api.get<UserAccessDto>(`/admin/users/${userId}/access`, undefined, signal) });

const refreshAccess = () => {
  invalidate('admin', 'user-access');
  invalidate('admin', 'access-logs');
};
export const revokeSession = (sessionId: string) => api.post(`/admin/sessions/${sessionId}/revoke`).finally(refreshAccess);
export const revokeAllSessions = (userId: string) => api.post(`/admin/users/${userId}/sessions/revoke-all`).finally(refreshAccess);

// ─── Configurações ──────────────────────────────────────────────────────────

export const usePlatformSettings = () => useQuery({ queryKey: ['admin', 'settings'], queryFn: ({ signal }) => api.get<PlatformSettingDto[]>('/admin/settings', undefined, signal) });
export const settingImpact = (key: string, value: boolean | number) => api.post<SettingImpactDto>(`/admin/settings/${key}/impact`, { value });
export const saveSetting = (key: string, value: boolean | number, confirm = false) =>
  api.put<PlatformSettingDto>(`/admin/settings/${key}`, { value, confirm }).finally(() => {
    invalidate('admin', 'settings');
    invalidate('platform-features');
  });

/** Flags públicas (ficha 43): o app esconde o que a plataforma desligou. Falhar não esconde nada. */
export const usePublicFeatures = () =>
  useQuery({ queryKey: ['platform-features'], staleTime: 30_000, refetchInterval: 60_000, queryFn: ({ signal }) => api.get<PublicFeaturesDto>('/platform/features', undefined, signal) });

// ─── Parceiros (admin) ──────────────────────────────────────────────────────

export const usePartnerApplications = (status: PartnerApplicationStatus, page: number) =>
  useQuery({ queryKey: ['admin', 'partners', status, page], refetchInterval: REFRESH_MS, queryFn: ({ signal }) => api.get<PartnerApplicationsPage>('/admin/partner-applications', { status, page, pageSize: 20 }, signal) });

const refreshPartners = () => {
  invalidate('admin', 'partners');
  invalidate('admin', 'establishments');
  invalidate('admin', 'overview');
};
export const approvePartner = (id: string, planId: string) => api.post<PartnerApplicationDto>(`/admin/partner-applications/${id}/approve`, { planId }).finally(refreshPartners);
export const rejectPartner = (id: string, message: string) => api.post<PartnerApplicationDto>(`/admin/partner-applications/${id}/reject`, { message }).finally(refreshPartners);
export const requestPartnerInfo = (id: string, message: string) => api.post<PartnerApplicationDto>(`/admin/partner-applications/${id}/request-info`, { message }).finally(refreshPartners);
export const partnerDocumentUrl = (id: string, documentId: string) => `${API_BASE_URL}/admin/partner-applications/${id}/documents/${documentId}`;

// ─── Portal do parceiro (sem conta: código de acompanhamento) ───────────────

const partnerHeaders = (token: string) => ({ 'X-Partner-Token': token });
export const submitPartnerApplication = (input: PartnerApplicationInput) => api.post<PartnerApplicationCreatedDto>('/partner-applications', input);
export const fetchPartnerApplication = (token: string) => api.send<PartnerApplicationDto>('GET', '/partner-applications/mine', { headers: partnerHeaders(token) });
export const updatePartnerApplication = (token: string, input: Partial<PartnerApplicationInput>) => api.send<PartnerApplicationDto>('PATCH', '/partner-applications/mine', { body: input, headers: partnerHeaders(token) });
export function uploadPartnerDocument(token: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return api.send<PartnerApplicationDto>('POST', '/partner-applications/mine/documents', { body: form, headers: partnerHeaders(token) });
}

// ─── Gestor: importar cardápio ──────────────────────────────────────────────

export const menuTemplateUrl = (establishmentId: string) => `${API_BASE_URL}/establishments/${establishmentId}/menu/import/template`;
export function importMenu(establishmentId: string, file: File, dryRun: boolean) {
  const form = new FormData();
  form.append('dryRun', String(dryRun));
  form.append('file', file);
  return api.send<MenuImportResultDto>('POST', `/establishments/${establishmentId}/menu/import`, { body: form }).finally(() => {
    if (!dryRun) void queryClient.invalidateQueries({ queryKey: staffKeys.root(establishmentId) });
  });
}

// ─── Gestor: planos ─────────────────────────────────────────────────────────

export const usePlanOptions = (establishmentId: string) =>
  useQuery({ queryKey: ['staff', establishmentId, 'plan-options'], queryFn: ({ signal }) => api.get<PlanComparisonDto>(`/establishments/${establishmentId}/plan/options`, undefined, signal) });
export const changePlan = (establishmentId: string, planId: string) =>
  api.post<PlanChangeResultDto>(`/establishments/${establishmentId}/plan/change`, { planId }).finally(() => void queryClient.invalidateQueries({ queryKey: staffKeys.root(establishmentId) }));

// ─── Gestor: campanhas segmentadas ──────────────────────────────────────────

const campaignsKey = (establishmentId: string) => ['staff', establishmentId, 'campaigns'] as const;
export const useCampaigns = (establishmentId: string) => useQuery({ queryKey: campaignsKey(establishmentId), queryFn: ({ signal }) => api.get<SegmentCampaignDto[]>(`/establishments/${establishmentId}/campaigns`, undefined, signal) });
export const saveCampaign = (establishmentId: string, input: SegmentCampaignInput, id?: string) =>
  (id ? api.patch<SegmentCampaignDto>(`/establishments/${establishmentId}/campaigns/${id}`, input) : api.post<SegmentCampaignDto>(`/establishments/${establishmentId}/campaigns`, input)).finally(() => invalidate(...campaignsKey(establishmentId)));
export const deleteCampaign = (establishmentId: string, id: string) => api.delete(`/establishments/${establishmentId}/campaigns/${id}`).finally(() => invalidate(...campaignsKey(establishmentId)));

// ─── Cliente: ofertas pessoais ──────────────────────────────────────────────

export const useMyOffers = (enabled: boolean) => useQuery({ queryKey: ['me', 'offers'], enabled, queryFn: ({ signal }) => api.get<MyOfferDto[]>('/me/offers', undefined, signal) });

/** Recurso ligado na plataforma? Enquanto não carregou (ou se falhar), mostra — a API recusa de qualquer forma. */
export const useFeatureEnabled = (key: keyof PublicFeaturesDto) => usePublicFeatures().data?.[key] !== false;
