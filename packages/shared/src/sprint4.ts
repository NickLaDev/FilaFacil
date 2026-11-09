// Contratos e regras da Sprint 4 (fichas 15, 30, 33, 38, 39, 48, 49, 56, 57, 62, 64, 66, 67 e 70).
import type { Page } from './contracts.js';

// ─── Alérgenos e restrições (ficha 64) ──────────────────────────────────────

export const ALLERGENS = [
  { key: 'gluten', label: 'Glúten' },
  { key: 'lactose', label: 'Leite e lactose' },
  { key: 'egg', label: 'Ovo' },
  { key: 'peanut', label: 'Amendoim' },
  { key: 'tree_nuts', label: 'Castanhas e nozes' },
  { key: 'soy', label: 'Soja' },
  { key: 'fish', label: 'Peixe' },
  { key: 'shellfish', label: 'Frutos do mar' },
  { key: 'sesame', label: 'Gergelim' },
  { key: 'pork', label: 'Carne suína' },
  { key: 'alcohol', label: 'Álcool' },
] as const;

export type AllergenKey = (typeof ALLERGENS)[number]['key'];
export const ALLERGEN_KEYS = ALLERGENS.map(a => a.key) as AllergenKey[];
export const isAllergen = (value: string): value is AllergenKey => (ALLERGEN_KEYS as string[]).includes(value);
export const allergenLabel = (key: string) => ALLERGENS.find(a => a.key === key)?.label ?? key;

/** Restrições do cliente que o item contém (interseção). Única regra de comparação, usada pelo app e pelos testes. */
export const restrictedAllergens = (itemAllergens: readonly string[], restrictions: readonly string[]): AllergenKey[] =>
  ALLERGEN_KEYS.filter(key => itemAllergens.includes(key) && restrictions.includes(key));

// ─── Notificações in-app ────────────────────────────────────────────────────

export type AppNotificationKind =
  | 'booking_confirmed'
  | 'booking_refused'
  | 'booking_cancelled'
  | 'review_request'
  | 'support_reply'
  | 'support_new'
  | 'invoice_overdue'
  | 'invoice_issued'
  | 'ingredient_expiring';

export interface AppNotificationDto {
  id: string;
  kind: AppNotificationKind;
  title: string;
  body: string;
  refId: string | null;
  read: boolean;
  createdAt: string;
}

export interface AppNotificationsDto {
  unread: number;
  items: AppNotificationDto[];
}

// ─── Cashback (ficha 15) ────────────────────────────────────────────────────

/** O líquido do pedido nunca fica abaixo deste valor (o gateway não cobra valor zero). */
export const MIN_NET_CENTS = 100;
export const CASHBACK_MAX_PERCENT = 50;

export type CashbackEntryType = 'earn' | 'redeem' | 'redeem_return' | 'earn_reversal';

export interface CashbackRuleDto {
  id: string;
  name: string;
  percent: number;
  promotionId: string | null;
  promotionName: string | null;
  active: boolean;
  createdAt: string;
}

export interface CashbackRuleInput {
  name: string;
  percent: number;
  promotionId?: string | null;
  active?: boolean;
}

export interface CashbackEntryDto {
  id: string;
  type: CashbackEntryType;
  cents: number;
  orderNumber: number;
  establishmentName: string;
  note: string | null;
  createdAt: string;
}

export interface CashbackDto {
  balanceCents: number;
  /** Cashback de pedidos ainda não entregues (aparece no perfil assim que o pedido for entregue). */
  pendingCents: number;
  entries: CashbackEntryDto[];
}

/** Cashback de um conjunto de itens elegíveis: percentual sobre o valor, truncado em centavos. */
export const cashbackFor = (eligibleCents: number, percent: number) => Math.floor((Math.max(eligibleCents, 0) * percent) / 100);

// ─── Cupons (ficha 56) ──────────────────────────────────────────────────────

export type CouponDiscountType = 'percent' | 'fixed';
export type CouponState = 'scheduled' | 'active' | 'expired' | 'inactive' | 'exhausted';

export interface CouponDto {
  id: string;
  code: string;
  description: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minOrderCents: number;
  startsAt: string;
  endsAt: string;
  maxUses: number | null;
  active: boolean;
  usedCount: number;
  state: CouponState;
}

export interface CouponInput {
  code: string;
  description?: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minOrderCents?: number;
  startsAt: string;
  endsAt: string;
  maxUses?: number | null;
  active?: boolean;
}

export interface CouponValidationDto {
  code: string;
  description: string;
  discountCents: number;
  discountType: CouponDiscountType;
  discountValue: number;
}

export const normalizeCouponCode = (code: string) => code.trim().toUpperCase();
export const COUPON_CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

/** Desconto do cupom sobre o subtotal, nunca deixando o líquido abaixo de MIN_NET_CENTS. */
export function couponDiscountFor(type: CouponDiscountType, value: number, subtotalCents: number): number {
  const raw = type === 'percent' ? Math.round((subtotalCents * value) / 100) : value;
  return Math.max(Math.min(raw, subtotalCents - MIN_NET_CENTS), 0);
}

// ─── Métodos de pagamento salvos (ficha 49) ─────────────────────────────────

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'elo' | 'hipercard' | 'other';

export const CARD_BRAND_LABELS: Record<CardBrand, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  elo: 'Elo',
  hipercard: 'Hipercard',
  other: 'Cartão',
};

export interface SavedPaymentMethodDto {
  id: string;
  kind: 'credit' | 'debit';
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
  holderName: string;
  isDefault: boolean;
  expired: boolean;
  createdAt: string;
}

export interface SavePaymentMethodRequest {
  kind: 'credit' | 'debit';
  /** Enviado só para tokenização: o servidor guarda apenas bandeira, final e validade. */
  number: string;
  holderName: string;
  expMonth: number;
  expYear: number;
  cvv: string;
  makeDefault?: boolean;
}

/** Validação de Luhn do número do cartão (só dígitos). */
export function isValidCardNumber(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

export function detectCardBrand(digits: string): CardBrand {
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) return 'mastercard';
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(digits)) return 'elo';
  if (/^(606282|3841)/.test(digits)) return 'hipercard';
  return 'other';
}

// ─── Reservas de mesa (ficha 30) ────────────────────────────────────────────

export const BOOKING_STATUSES = ['confirmed', 'refused', 'cancelled', 'seated'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  confirmed: 'Confirmada',
  refused: 'Recusada',
  cancelled: 'Cancelada',
  seated: 'Cliente chegou',
};

/** Tempo que a reserva ocupa a mesa. */
export const BOOKING_DURATION_MINUTES = 90;
export const BOOKING_MIN_LEAD_MINUTES = 30;
export const BOOKING_MAX_DAYS_AHEAD = 60;
export const BOOKING_MAX_PARTY = 20;
export const BOOKING_SLOT_STEP_MINUTES = 30;

export interface CreateBookingRequest {
  establishmentId: string;
  /** Início da reserva (ISO 8601). */
  startsAt: string;
  partySize: number;
}

export interface BookingDto {
  id: string;
  establishmentId: string;
  establishmentName: string;
  /** Fuso do estabelecimento: data e hora da reserva são exibidas nele. */
  timezone: string;
  tableLabel: string | null;
  partySize: number;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  refusalReason: string | null;
  customerName?: string;
  customerPhone?: string | null;
  createdAt: string;
}

export interface BookingSlotDto {
  startsAt: string;
  /** HH:mm no fuso do estabelecimento. */
  label: string;
  available: boolean;
}

export interface BookingSlotsDto {
  date: string;
  timezone: string;
  slots: BookingSlotDto[];
}

// ─── Avaliações (ficha 48) ──────────────────────────────────────────────────

export interface CreateReviewRequest {
  rating: number;
  comment?: string;
}

export interface ReviewDto {
  id: string;
  rating: number;
  comment: string;
  /** Nome curto (primeiro nome + inicial). */
  authorName: string;
  createdAt: string;
}

export interface MyReviewDto extends ReviewDto {
  orderId: string;
  establishmentId: string;
}

export interface RestaurantReviewsDto {
  average: number;
  count: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  items: ReviewDto[];
}

// ─── Compartilhar restaurante (ficha 62) ────────────────────────────────────

export const SHARE_SOURCES = ['whatsapp', 'telegram', 'sms', 'email', 'copy', 'native', 'other'] as const;
export type ShareSource = (typeof SHARE_SOURCES)[number];

export const SHARE_SOURCE_LABELS: Record<ShareSource, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  sms: 'SMS',
  email: 'E-mail',
  copy: 'Link copiado',
  native: 'Compartilhar do aparelho',
  other: 'Outros',
};

export interface ShareVisitsDto {
  total: number;
  bySource: { source: string; count: number }[];
}

// ─── Duplicar item (ficha 67) ───────────────────────────────────────────────

export interface DuplicateMenuItemRequest {
  name?: string;
  description?: string;
  priceCents?: number;
  categoryName?: string;
  allergens?: string[];
}

// ─── Validade de insumos (ficha 70) ─────────────────────────────────────────

export const EXPIRY_ALERT_MIN_DAYS = 3;
export const EXPIRY_ALERT_MAX_DAYS = 30;

export interface IngredientLotDto {
  id: string;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  code: string;
  quantity: string | null;
  /** AAAA-MM-DD. */
  expiresOn: string;
  /** Dias até o vencimento no calendário da casa (negativo = vencido). */
  daysLeft: number;
  state: 'ok' | 'expiring' | 'expired' | 'closed';
  closedAt: string | null;
  /** Pratos que usam o insumo (sugestão para priorizar o uso). */
  dishes: { id: string; name: string }[];
}

export interface IngredientLotInput {
  ingredientId: string;
  code: string;
  quantity?: number | null;
  expiresOn: string;
}

export interface ExpirySettingsDto {
  alertDays: number;
}

// ─── Relatório de custo (ficha 57) ──────────────────────────────────────────

export interface CostReportRow {
  menuItemId: string;
  name: string;
  category: string;
  quantity: number;
  revenueCents: number;
  /** Custo total (custo da ficha × quantidade), em centavos; null = item sem ficha técnica. */
  costCents: number | null;
  marginCents: number | null;
  marginPercent: number | null;
}

export interface CostReportCategory {
  category: string;
  quantity: number;
  revenueCents: number;
  costCents: number;
  marginCents: number;
  marginPercent: number | null;
}

export interface CostReportDto {
  from: string;
  to: string;
  rows: CostReportRow[];
  categories: CostReportCategory[];
  /**
   * `revenueCents`: tudo que foi vendido no período. Custo e margem consideram só os itens com ficha técnica
   * (`coveredRevenueCents`): item sem ficha não entra no custo, então também não entra na margem.
   */
  totals: { quantity: number; revenueCents: number; coveredRevenueCents: number; costCents: number; marginCents: number; marginPercent: number | null };
  /** Itens vendidos sem ficha técnica: o custo deles não entra nos totais. */
  itemsWithoutSheet: number;
}

// ─── Central de suporte (ficha 39) ──────────────────────────────────────────

export const SUPPORT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];
export const SUPPORT_PRIORITY_LABELS: Record<SupportPriority, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
export const SUPPORT_PRIORITY_RANK: Record<SupportPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

export const SUPPORT_STATUSES = ['open', 'in_progress', 'resolved'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = { open: 'Aberto', in_progress: 'Em andamento', resolved: 'Resolvido' };

export interface SupportMessageDto {
  id: string;
  side: 'platform' | 'establishment';
  authorName: string;
  body: string;
  createdAt: string;
}

export interface SupportTicketDto {
  id: string;
  number: number;
  establishmentId: string;
  establishmentName: string;
  subject: string;
  priority: SupportPriority;
  status: SupportStatus;
  createdAt: string;
  lastMessageAt: string;
  messageCount: number;
  /** Última mensagem é da casa e a plataforma ainda não respondeu. */
  awaitingPlatform: boolean;
}

export interface SupportTicketDetailDto extends SupportTicketDto {
  messages: SupportMessageDto[];
}

export interface CreateSupportTicketRequest {
  subject: string;
  priority: SupportPriority;
  message: string;
}

// ─── Integrações e incidentes (ficha 33) ────────────────────────────────────

/** Sem heartbeat por este tempo = integração fora do ar (o monitor roda a cada 10 s: detecção em até ~40 s). */
export const INTEGRATION_OFFLINE_AFTER_MS = 30_000;

export const INTEGRATION_KINDS = ['pdv', 'erp', 'delivery', 'other'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];
export const INTEGRATION_KIND_LABELS: Record<IntegrationKind, string> = { pdv: 'PDV', erp: 'ERP', delivery: 'Delivery', other: 'Outra' };

export type IntegrationStatus = 'unknown' | 'online' | 'offline';

export interface IntegrationDto {
  id: string;
  establishmentId: string;
  establishmentName: string;
  name: string;
  kind: IntegrationKind;
  status: IntegrationStatus;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface IntegrationCreatedDto extends IntegrationDto {
  /** Chave do dispositivo: mostrada uma única vez. */
  deviceKey: string;
}

export interface IncidentDto {
  id: string;
  integrationId: string;
  integrationName: string;
  integrationKind: IntegrationKind;
  establishmentId: string;
  establishmentName: string;
  cause: 'heartbeat_timeout' | 'reported';
  message: string;
  startedAt: string;
  resolvedAt: string | null;
  durationSeconds: number;
}

export interface MonitoringOverviewDto {
  integrations: IntegrationDto[];
  activeIncidents: IncidentDto[];
  /** Estabelecimentos distintos com incidente ativo. */
  impactedEstablishments: number;
  checkedAt: string;
}

// ─── Faturas da plataforma (ficha 38) ───────────────────────────────────────

export const INVOICE_DUE_DAY = 10;
/** Depois do vencimento, a pendência é lembrada a cada tantos dias. */
export const INVOICE_REMINDER_DAYS = 3;

export const INVOICE_STATUSES = ['pending', 'paid', 'overdue', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = { pending: 'Pendente', paid: 'Pago', overdue: 'Atrasado', cancelled: 'Cancelada' };

export interface InvoiceDto {
  id: string;
  number: number;
  establishmentId: string;
  establishmentName: string;
  period: string;
  planName: string;
  amountCents: number;
  /** AAAA-MM-DD. */
  dueDate: string;
  status: InvoiceStatus;
  paidAt: string | null;
  paymentNote: string | null;
}

export interface InvoicesPage extends Page<InvoiceDto> {
  counts: Record<'all' | InvoiceStatus, number>;
  /** Soma das faturas atrasadas, em centavos. */
  overdueCents: number;
}

export interface MarkInvoicePaidRequest {
  note?: string;
}

export interface BillingRunDto {
  generated: number;
  markedOverdue: number;
  notified: number;
}

// ─── Histórico de alterações do estabelecimento (ficha 66) ──────────────────

/** Campos do cadastro do estabelecimento que geram histórico, com o rótulo exibido. */
export const ESTABLISHMENT_FIELD_LABELS: Record<string, string> = {
  created: 'Cadastro criado',
  name: 'Nome',
  type: 'Tipo',
  city: 'Cidade',
  address: 'Endereço',
  latitude: 'Latitude',
  longitude: 'Longitude',
  timezone: 'Fuso horário',
  organization: 'Organização',
  plan: 'Plano',
  status: 'Status',
  foodCategories: 'Categorias de comida',
  tags: 'Tags',
  averageWaitMinutes: 'Tempo médio de espera (min)',
  pickupPoint: 'Local de retirada',
  ordersPaused: 'Pedidos pausados',
  highDemand: 'Alta demanda',
  openingHours: 'Horário de funcionamento',
  photos: 'Fotos',
  expiryAlertDays: 'Antecedência do alerta de validade (dias)',
};

export interface EstablishmentChangeDto {
  id: string;
  establishmentId: string;
  establishmentName: string;
  actorName: string;
  field: string;
  fieldLabel: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}
