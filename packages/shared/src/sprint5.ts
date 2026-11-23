// Contratos e regras da Sprint 5 (fichas 32, 35, 40, 41, 42, 43, 52, 54, 55, 58, 68 e 69).
import type { EstablishmentStatus, EstablishmentType, PlanFeature } from './access.js';
import type { Page } from './contracts.js';
import type { CouponDiscountType, IntegrationDto } from './sprint4.js';

/** Calendário dos números da plataforma (dia civil de Brasília). */
export const PLATFORM_TIMEZONE = 'America/Sao_Paulo';

// ─── Painel multi-estabelecimento (ficha 32) ────────────────────────────────

export type EstablishmentProblem = 'incident' | 'overdue_invoice' | 'orders_paused' | 'no_orders_today';

export const ESTABLISHMENT_PROBLEM_LABELS: Record<EstablishmentProblem, string> = {
  incident: 'Integração fora do ar',
  overdue_invoice: 'Fatura em atraso',
  orders_paused: 'Pedidos pausados',
  no_orders_today: 'Sem pedidos hoje',
};

export interface DayMetrics {
  orders: number;
  gmvCents: number;
  activeUsers: number;
}

export interface OverviewEstablishmentRow {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  status: EstablishmentStatus;
  planName: string;
  today: { orders: number; gmvCents: number };
  yesterday: { orders: number; gmvCents: number };
  problems: EstablishmentProblem[];
}

export interface PlatformOverviewDto {
  date: string;
  activeEstablishments: number;
  /** Fora dos totais (não estão ativos), mostrados à parte. */
  suspendedEstablishments: number;
  organizations: number;
  today: DayMetrics;
  yesterday: DayMetrics;
  establishments: OverviewEstablishmentRow[];
  activeUsers: { id: string; name: string; role: string; lastAccessAt: string | null }[];
  generatedAt: string;
}

// ─── Métricas (ficha 41) ────────────────────────────────────────────────────

export interface MetricsPoint extends DayMetrics {
  date: string;
}

export interface MetricsPeriod {
  from: string;
  to: string;
  totals: DayMetrics;
  series: MetricsPoint[];
}

export interface PlatformMetricsDto {
  current: MetricsPeriod;
  /** Período anterior de mesmo tamanho (ou o informado em compareFrom/compareTo). */
  previous: MetricsPeriod;
  /** Variação percentual atual × anterior (null quando o anterior é zero). */
  change: { orders: number | null; gmvCents: number | null; activeUsers: number | null };
  /** Pedidos e GMV por estabelecimento no período atual: a soma bate com os totais. */
  byEstablishment: { id: string; name: string; orders: number; gmvCents: number }[];
}

export const percentChange = (current: number, previous: number) => (previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10);

// ─── Organizações (ficha 35) ────────────────────────────────────────────────

export type OrganizationRole = 'admin' | 'viewer';

export const ORGANIZATION_ROLE_LABELS: Record<OrganizationRole, string> = {
  admin: 'Administrador da rede (acesso a todas as unidades)',
  viewer: 'Visualizador (só relatório consolidado)',
};

export interface OrganizationSummaryDto {
  id: string;
  name: string;
  units: number;
  activeUnits: number;
  members: number;
  createdAt: string;
}

export interface OrganizationMemberDto {
  userId: string;
  name: string;
  email: string | null;
  userRole: string;
  role: OrganizationRole;
}

export interface OrganizationReportDto {
  organizationId: string;
  organizationName: string;
  from: string;
  to: string;
  totals: { orders: number; gmvCents: number; averageTicketCents: number };
  units: { id: string; name: string; status: EstablishmentStatus; planName: string; orders: number; gmvCents: number; averageTicketCents: number }[];
}

export interface OrganizationDetailDto extends Omit<OrganizationSummaryDto, 'members'> {
  members: OrganizationMemberDto[];
  establishments: { id: string; name: string; status: EstablishmentStatus; city: string }[];
  report: OrganizationReportDto;
}

// ─── Integrações externas (ficha 40) ────────────────────────────────────────

export interface IntegrationCheckDto {
  id: string;
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
  trigger: 'manual' | 'monitor';
  createdAt: string;
}

export interface IntegrationDetailDto extends IntegrationDto {
  enabled: boolean;
  healthUrl: string | null;
  checks: IntegrationCheckDto[];
}

/** Status exibido: `unavailable` = fora do ar (sem sinal, falha informada ou teste falhando). */
export const INTEGRATION_STATUS_LABELS = { online: 'Disponível', offline: 'Indisponível', unknown: 'Sem sinal ainda', disabled: 'Desativada' } as const;

// ─── Auditoria (ficha 42) ───────────────────────────────────────────────────

export const AUDIT_ACTIONS = {
  'user.deleted': 'Conta excluída',
  'user.access_changed': 'Acesso de usuário alterado',
  'user.suspended': 'Usuário suspenso',
  'user.reactivated': 'Usuário reativado',
  'session.revoked': 'Sessão encerrada remotamente',
  'sessions.revoked_all': 'Todas as sessões encerradas',
  'establishment.created': 'Estabelecimento cadastrado',
  'establishment.updated': 'Cadastro de estabelecimento alterado',
  'establishment.status_changed': 'Status de estabelecimento alterado',
  'establishment.plan_changed': 'Plano de estabelecimento alterado',
  'plan.created': 'Plano criado',
  'plan.updated': 'Plano alterado',
  'plan.deleted': 'Plano excluído',
  'plan.self_service_change': 'Troca de plano pelo gestor',
  'organization.created': 'Organização criada',
  'organization.updated': 'Organização alterada',
  'organization.establishment_linked': 'Estabelecimento vinculado à organização',
  'organization.member_set': 'Papel na organização definido',
  'organization.member_removed': 'Papel na organização removido',
  'integration.created': 'Integração cadastrada',
  'integration.updated': 'Integração alterada',
  'integration.deleted': 'Integração removida',
  'integration.key_rotated': 'Chave de integração trocada',
  'integration.tested': 'Integração testada manualmente',
  'invoice.paid': 'Pagamento de fatura registrado',
  'invoice.cancelled': 'Fatura cancelada',
  'billing.run': 'Rotina de cobrança executada',
  'settings.updated': 'Configuração da plataforma alterada',
  'partner.approved': 'Parceiro aprovado',
  'partner.rejected': 'Parceiro recusado',
  'partner.info_requested': 'Mais informações pedidas ao parceiro',
  'order.refunded': 'Pedido estornado',
  'menu.imported': 'Cardápio importado',
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;
export const auditActionLabel = (action: string) => (AUDIT_ACTIONS as Record<string, string>)[action] ?? action;

export interface AuditLogDto {
  id: string;
  actorId: string | null;
  actorName: string;
  actorRole: string | null;
  action: string;
  actionLabel: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  details: unknown;
  ipAddress: string | null;
  createdAt: string;
}

// ─── Configurações da plataforma (ficha 43) ─────────────────────────────────

export interface SettingDefinition {
  key: string;
  label: string;
  description: string;
  group: 'features' | 'parameters';
  type: 'boolean' | 'number';
  default: boolean | number;
  min?: number;
  max?: number;
  /** Alteração crítica: o servidor exige confirmação depois de mostrar o impacto. */
  critical?: boolean;
}

export const PLATFORM_SETTINGS = [
  { key: 'features.bookings', label: 'Reservas de mesa', description: 'Clientes reservam mesa com data e horário (ficha 30).', group: 'features', type: 'boolean', default: true, critical: true },
  { key: 'features.reviews', label: 'Avaliações', description: 'Clientes avaliam pedidos entregues (ficha 48).', group: 'features', type: 'boolean', default: true },
  { key: 'features.coupons', label: 'Cupons de desconto', description: 'Cupons por código no checkout (ficha 56).', group: 'features', type: 'boolean', default: true, critical: true },
  { key: 'features.cashback', label: 'Cashback', description: 'Pedidos novos geram e usam cashback (ficha 15).', group: 'features', type: 'boolean', default: true, critical: true },
  { key: 'features.partnerSignup', label: 'Cadastro de novos parceiros', description: 'Formulário público para novos estabelecimentos (ficha 55).', group: 'features', type: 'boolean', default: true },
  { key: 'features.menuImport', label: 'Importar cardápio por planilha', description: 'Gestor importa o cardápio em massa (ficha 54).', group: 'features', type: 'boolean', default: true },
  { key: 'features.planSelfService', label: 'Troca de plano pelo gestor', description: 'Upgrade/downgrade pelo painel (ficha 58).', group: 'features', type: 'boolean', default: true },
  { key: 'bookings.maxPartySize', label: 'Máximo de pessoas por reserva', description: 'Limite de pessoas em uma reserva de mesa.', group: 'parameters', type: 'number', default: 20, min: 1, max: 50 },
  { key: 'bookings.minLeadMinutes', label: 'Antecedência mínima da reserva (min)', description: 'Quanto tempo antes do horário a reserva ainda pode ser feita.', group: 'parameters', type: 'number', default: 30, min: 0, max: 1440 },
  { key: 'menuImport.maxRows', label: 'Linhas por importação de cardápio', description: 'Limite de itens em uma planilha.', group: 'parameters', type: 'number', default: 500, min: 10, max: 2000 },
  { key: 'integrations.offlineAfterSeconds', label: 'Sem sinal até virar incidente (s)', description: 'Tempo sem heartbeat para a integração ficar indisponível e abrir incidente.', group: 'parameters', type: 'number', default: 30, min: 15, max: 50, critical: true },
] as const satisfies readonly SettingDefinition[];

export type PlatformSettingKey = (typeof PLATFORM_SETTINGS)[number]['key'];
export const settingDefinition = (key: string): SettingDefinition | undefined => (PLATFORM_SETTINGS as readonly SettingDefinition[]).find(def => def.key === key);

export interface PlatformSettingDto extends SettingDefinition {
  value: boolean | number;
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface SettingImpactDto {
  key: string;
  critical: boolean;
  message: string;
  /** Quantos registros são afetados (ex.: reservas futuras confirmadas). */
  affected: number;
}

/** Flags públicas lidas pelo app para esconder o que está desligado. */
export type PublicFeaturesDto = Record<'bookings' | 'reviews' | 'coupons' | 'cashback' | 'partnerSignup', boolean>;

// ─── Acessos e dispositivos (ficha 52) ──────────────────────────────────────

export interface AccessLogDto {
  id: string;
  userId: string;
  userName: string;
  ipAddress: string | null;
  deviceLabel: string;
  method: string;
  newDevice: boolean;
  sessionId: string | null;
  sessionActive: boolean;
  createdAt: string;
}

export interface UserSessionDto {
  id: string;
  deviceLabel: string;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  active: boolean;
}

export interface UserAccessDto {
  userId: string;
  userName: string;
  sessions: UserSessionDto[];
  logins: AccessLogDto[];
}

/** "Chrome · Windows", "Safari · iPhone"… a partir do User-Agent (só para exibição). */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ua ? 'Navegador' : 'Desconhecido';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'outro sistema';
  return `${browser} · ${os}`;
}

// ─── Importar cardápio (ficha 54) ───────────────────────────────────────────

export const MENU_IMPORT_COLUMNS = ['nome', 'descricao', 'categoria', 'preco', 'disponivel', 'alergenos', 'estacao'] as const;

export interface MenuImportRowResult {
  line: number;
  name: string;
  status: 'created' | 'updated' | 'error' | 'valid';
  errors: string[];
}

export interface MenuImportResultDto {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  failed: number;
  rows: MenuImportRowResult[];
  /** CSV só com as linhas com erro (e a coluna "erro"), para corrigir e reimportar. */
  errorCsv: string | null;
  durationMs: number;
}

// ─── Aprovação de parceiro (ficha 55) ───────────────────────────────────────

export type PartnerApplicationStatus = 'pending' | 'needs_info' | 'approved' | 'rejected';

export const PARTNER_STATUS_LABELS: Record<PartnerApplicationStatus, string> = {
  pending: 'Aguardando análise',
  needs_info: 'Aguardando mais informações',
  approved: 'Aprovado',
  rejected: 'Recusado',
};

export interface PartnerApplicationInput {
  businessName: string;
  type: EstablishmentType;
  document: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  /** HH:MM */
  opensAt: string;
  closesAt: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes?: string;
}

export interface PartnerDocumentDto {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface PartnerApplicationDto extends Omit<PartnerApplicationInput, 'notes'> {
  id: string;
  number: number;
  status: PartnerApplicationStatus;
  notes: string;
  infoRequest: string | null;
  decisionReason: string | null;
  establishmentId: string | null;
  documents: PartnerDocumentDto[];
  createdAt: string;
  reviewedAt: string | null;
}

export interface PartnerApplicationCreatedDto {
  application: PartnerApplicationDto;
  /** Mostrado uma única vez: é a chave para acompanhar e completar o cadastro. */
  trackingToken: string;
}

export type PartnerApplicationsPage = Page<PartnerApplicationDto> & { counts: Record<PartnerApplicationStatus, number> };

/** CNPJ com dígitos verificadores. */
export function isValidCnpj(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const calc = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, weight, index) => acc + Number(digits[index]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === Number(digits[12]) && calc(13) === Number(digits[13]);
}

// ─── Planos: comparação e troca (fichas 58 e 69) ────────────────────────────

export interface PlanOptionDto {
  id: string;
  name: string;
  monthlyPriceCents: number;
  limits: { units: number; tables: number; staff: number };
  features: PlanFeature[];
  current: boolean;
  /** Valor proporcional da troca hoje: positivo = cobrança agora; negativo = crédito na próxima mensalidade. */
  prorationCents: number;
  /** Motivos que impedem a troca (ex.: mais mesas do que o plano permite). */
  blockers: string[];
}

export interface PlanComparisonDto {
  establishmentId: string;
  currentPlanId: string;
  /** Dias restantes no mês (incluindo hoje) e total de dias, usados no cálculo proporcional. */
  remainingDays: number;
  daysInMonth: number;
  plans: PlanOptionDto[];
}

export interface PlanChangeResultDto {
  planId: string;
  planName: string;
  features: PlanFeature[];
  prorationCents: number;
  invoiceId: string | null;
}

/** Diferença proporcional (centavos) entre dois preços mensais para os dias restantes do mês. */
export const prorationFor = (fromCents: number, toCents: number, remainingDays: number, daysInMonth: number) =>
  Math.round(((toCents - fromCents) * remainingDays) / daysInMonth);

// ─── Promoção segmentada (ficha 68) ─────────────────────────────────────────

export const CUSTOMER_SEGMENTS = ['birthday', 'inactive', 'frequent'] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

export const CUSTOMER_SEGMENT_LABELS: Record<CustomerSegment, string> = {
  birthday: 'Aniversariantes do dia',
  inactive: 'Clientes inativos',
  frequent: 'Clientes frequentes',
};

export interface SegmentCampaignInput {
  name: string;
  segment: CustomerSegment;
  /** inactive: dias sem pedir; frequent: mínimo de pedidos nos últimos 30 dias; birthday: ignorado. */
  threshold?: number;
  discountType: CouponDiscountType;
  discountValue: number;
  validDays: number;
  message?: string;
  active?: boolean;
}

export interface SegmentCampaignDto extends Required<Omit<SegmentCampaignInput, 'threshold'>> {
  id: string;
  threshold: number;
  /** Clientes que receberam o cupom, quantos usaram e a taxa de uso (%). */
  sent: number;
  used: number;
  usageRate: number | null;
  /** Clientes que entram no segmento hoje (prévia). */
  eligibleNow: number;
  createdAt: string;
}

export interface MyOfferDto {
  code: string;
  establishmentId: string;
  establishmentName: string;
  campaignName: string;
  description: string;
  endsAt: string;
  used: boolean;
}
