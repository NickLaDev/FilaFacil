// Formato das respostas da API. Datas trafegam em ISO 8601 (UTC); dinheiro em centavos inteiros;
// valores com casas decimais variáveis (custo de insumo, quantidade) trafegam como string decimal.
import type { EstablishmentStatus, EstablishmentType, Permission, PlanFeature, UserRole, UserStatus } from './access.js';

// ─── Comuns ─────────────────────────────────────────────────────────────────

/** Header exigido pela API em métodos que alteram estado (defesa contra CSRF com cookies). */
export const CLIENT_HEADER = { name: 'X-FilaFacil-Client', value: 'web' } as const;

export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: ApiFieldError[];
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ─── Autenticação e perfil ──────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  cpfMasked: string | null;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  permissions: Permission[];
  createdAt: string;
}

export interface StaffMembership {
  establishmentId: string;
  establishmentName: string;
  establishmentStatus: EstablishmentStatus;
  address: string;
  organizationId: string;
  organizationName: string;
}

export interface MeResponse {
  user: AuthUser;
  memberships: StaffMembership[];
}

export interface AddressDto {
  id: string;
  label: string;
  street: string;
  city: string;
  isDefault: boolean;
}

export interface AuthProvidersResponse {
  google: boolean;
  apple: boolean;
}

export type OtpChannel = 'phone' | 'email';

export interface OtpChallengeResponse {
  challengeId: string;
  channel: OtpChannel;
  destinationMasked: string;
  expiresAt: string;
  resendAvailableAt: string;
}

// ─── Restaurantes (cliente) ─────────────────────────────────────────────────

/** Situação operacional vista pelo cliente, derivada de status, horário e flags da casa. */
export type OrderingStatus = 'open' | 'busy' | 'paused' | 'closed';

export interface OpeningHourDto {
  /** 0 = domingo … 6 = sábado, no fuso do estabelecimento. */
  weekday: number;
  /** "HH:MM". Fechamento menor que a abertura significa que passa da meia-noite. */
  opensAt: string;
  closesAt: string;
}

export interface RestaurantSummary {
  id: string;
  name: string;
  type: EstablishmentType;
  foodCategories: string[];
  tags: string[];
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  /** Distância em linha reta até o cliente; null quando a busca não recebe coordenadas. */
  distanceM: number | null;
  rating: number;
  ratingCount: number;
  averageWaitMinutes: number;
  orderingStatus: OrderingStatus;
  acceptingOrders: boolean;
  isOpenNow: boolean;
  /** Ex.: "Hoje: 17:00–02:00", "Abre às 18:00", "Fechado hoje". */
  hoursLabel: string;
  images: string[];
}

export interface RestaurantDetail extends RestaurantSummary {
  timezone: string;
  openingHours: OpeningHourDto[];
}

export interface PublicPromotion {
  id: string;
  name: string;
  discountPercent: number;
  endsAt: string;
}

export interface PublicMenuItem {
  id: string;
  categoryId: string;
  category: string;
  name: string;
  description: string;
  priceCents: number;
  /** Preço vigente calculado pelo servidor (promoção ativa e liberada pelo plano). */
  finalPriceCents: number;
  imageUrl: string | null;
  promotion: PublicPromotion | null;
}

export interface PublicMenu {
  establishmentId: string;
  categories: { id: string; name: string }[];
  items: PublicMenuItem[];
}

// ─── Cardápio (gestor/atendente) ────────────────────────────────────────────

export interface MenuCategoryDto {
  id: string;
  name: string;
  position: number;
}

export interface ManagedMenuItem {
  id: string;
  categoryId: string;
  category: string;
  name: string;
  description: string;
  priceCents: number;
  imageUrl: string | null;
  available: boolean;
  position: number;
  updatedAt: string;
}

export interface AvailabilityChangeDto {
  id: string;
  menuItemId: string;
  itemName: string;
  available: boolean;
  actorName: string;
  createdAt: string;
}

export type PromotionState = 'scheduled' | 'active' | 'expired';

export interface PromotionDto {
  id: string;
  name: string;
  discountPercent: number;
  startsAt: string;
  endsAt: string;
  itemIds: string[];
  state: PromotionState;
}

export const INGREDIENT_UNITS = ['un', 'kg', 'g', 'L', 'ml'] as const;
export type IngredientUnit = (typeof INGREDIENT_UNITS)[number];

export interface IngredientDto {
  id: string;
  name: string;
  unit: IngredientUnit;
  unitCost: string;
  usedInSheets: number;
}

export interface TechnicalSheetLineDto {
  ingredientId: string;
  ingredientName: string;
  unit: IngredientUnit;
  quantity: string;
  unitCost: string;
  lineCost: string;
}

export interface TechnicalSheetDto {
  id: string;
  menuItemId: string;
  menuItemName: string;
  priceCents: number;
  /** Custo máximo aceito, em % do preço de venda. */
  costLimitPercent: number;
  lines: TechnicalSheetLineDto[];
  /** Soma calculada pelo servidor a partir do custo atual dos insumos. */
  totalCost: string;
  costPercent: number;
  overLimit: boolean;
  updatedAt: string;
}

// ─── Salão e fila ───────────────────────────────────────────────────────────

export const TABLE_SHAPES = ['round', 'square', 'rect'] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

export type TableOccupancyStatus = 'free' | 'occupied';

export interface DiningTableDto {
  id: string;
  label: string;
  shape: TableShape;
  capacity: number;
  /** Centro da mesa em % da área da planta (0–100). */
  x: number;
  y: number;
  qrCode: string;
  occupancy: { status: TableOccupancyStatus; partySize: number; since: string | null };
}

export interface FloorPlanDto {
  establishmentId: string;
  /** Incrementa a cada gravação; usado para detectar edição concorrente. */
  version: number;
  tables: DiningTableDto[];
  updatedAt: string | null;
}

export type WaitlistStatus = 'waiting' | 'notified';

export interface WaitlistEntryDto {
  id: string;
  name: string;
  phone: string;
  partySize: number;
  position: number;
  status: WaitlistStatus;
  joinedAt: string;
  /** Estimativa informada ao grupo quando entrou na fila. */
  quotedWaitMinutes: number;
  /** Estimativa atual pelas mesas livres; null para quem já foi notificado. */
  estimatedWaitMinutes: number | null;
  notifiedAt: string | null;
  notifiedTableLabel: string | null;
}

export interface WaitlistDto {
  entries: WaitlistEntryDto[];
  freeTables: number;
}

export interface ReleaseTablesResponse {
  notifiedEntry: WaitlistEntryDto | null;
}

// ─── Planos e administração ─────────────────────────────────────────────────

export interface PlanLimits {
  units: number;
  tables: number;
  staff: number;
}

export interface PlanDto {
  id: string;
  name: string;
  monthlyPriceCents: number;
  limits: PlanLimits;
  features: PlanFeature[];
  establishmentCount: number;
}

/** Plano efetivo de um estabelecimento, consultado pela equipe para liberar/bloquear seções. */
export interface EstablishmentPlanDto {
  id: string;
  name: string;
  limits: PlanLimits;
  features: PlanFeature[];
}

export interface OrganizationDto {
  id: string;
  name: string;
}

export interface EstablishmentPhotoDto {
  id: string;
  url: string;
}

export interface AdminEstablishmentDto {
  id: string;
  name: string;
  type: EstablishmentType;
  status: EstablishmentStatus;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  timezone: string;
  organization: OrganizationDto;
  plan: { id: string; name: string };
  foodCategories: string[];
  tags: string[];
  averageWaitMinutes: number;
  ordersPaused: boolean;
  highDemand: boolean;
  rating: number;
  ratingCount: number;
  openingHours: OpeningHourDto[];
  photos: EstablishmentPhotoDto[];
  managerNames: string[];
  createdAt: string;
}

export interface AdminEstablishmentsPage extends Page<AdminEstablishmentDto> {
  counts: Record<'all' | EstablishmentStatus, number>;
}

export interface AdminUserDto {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  permissions: Permission[];
  memberships: { establishmentId: string; establishmentName: string }[];
  lastAccessAt: string | null;
  createdAt: string;
}

export interface AdminUsersPage extends Page<AdminUserDto> {
  counts: Record<'all' | UserRole, number>;
}

export type PermissionAuditAction = 'role_changed' | 'permissions_changed' | 'memberships_changed' | 'suspended' | 'reactivated';

export interface PermissionAuditDto {
  id: string;
  targetUserId: string;
  targetUserName: string;
  actorName: string;
  action: PermissionAuditAction;
  description: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

// ─── Tempo real ─────────────────────────────────────────────────────────────

export const REALTIME_NAMESPACE = '/realtime';

export const REALTIME_EVENTS = {
  /** Cardápio público de um restaurante mudou (item, disponibilidade, promoção ou plano). */
  menuUpdated: 'menu.updated',
  /** Dados públicos do restaurante mudaram (status, horário, fotos). */
  restaurantUpdated: 'restaurant.updated',
  floorPlanUpdated: 'floor-plan.updated',
  waitlistUpdated: 'waitlist.updated',
  availabilityChanged: 'availability.changed',
  /** Plano/status do estabelecimento mudou: a equipe recarrega recursos liberados. */
  establishmentUpdated: 'establishment.updated',
  /** Sessão revogada (logout em outro lugar, suspensão): o app encerra o acesso na hora. */
  sessionRevoked: 'session.revoked',
} as const;

export type RealtimeEvent = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

/** Sala que o cliente pode assinar; salas de equipe e de usuário são atribuídas pelo servidor. */
export interface RealtimeSubscribeRequest {
  restaurantId?: string;
  establishmentId?: string;
}

export interface RealtimePayload {
  establishmentId?: string;
  reason?: string;
}
