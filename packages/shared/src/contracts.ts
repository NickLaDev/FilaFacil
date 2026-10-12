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
  /** A conta tem senha (define se a exclusão pede senha ou código). */
  hasPassword: boolean;
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

export type PaymentProviderId = 'mercadopago' | 'simulated' | 'none';

export interface AuthProvidersResponse {
  google: boolean;
  apple: boolean;
  /** Gateway de pagamento ativo; `simulated` = demonstração, sem valor financeiro. */
  paymentProvider: PaymentProviderId;
  /** Canais por onde a API consegue enviar códigos de verificação neste ambiente. */
  codeChannels: Record<OtpChannel, boolean>;
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
  /** Ficha 12: o botão "Reservar" só aparece com o recurso de fila no plano e o restaurante aberto. */
  reservationsOpen: boolean;
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
  /** Um dos itens mais vendidos nos últimos 30 dias (ficha 46; recalculado toda semana). */
  isTopOrdered: boolean;
  /** Destaque manual do gestor (ficha 46). */
  isHighlighted: boolean;
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
  /** Destaque manual do gestor (ficha 46). */
  highlighted: boolean;
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
  /** Entrou pelo botão "Reservar" do cliente (e não cadastrado pela equipe). */
  byCustomer: boolean;
}

/** Ficha 12: a reserva do cliente (visão dele, sem dados de outros grupos). */
export interface MyReservationDto {
  id: string;
  partySize: number;
  position: number;
  status: WaitlistStatus;
  joinedAt: string;
  quotedWaitMinutes: number;
  estimatedWaitMinutes: number | null;
  notifiedTableLabel: string | null;
}

/** Ficha 13: atalho "Minhas reservas" no perfil. */
export interface MyReservationListItemDto extends MyReservationDto {
  restaurantId: string;
  restaurantName: string;
}

export interface MyReservationsDto {
  items: MyReservationListItemDto[];
}

export interface MyReservationStateDto {
  /** Cliente tem celular cadastrado (senão precisa informar um para ser avisado). */
  hasPhone: boolean;
  reservation: MyReservationDto | null;
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
  pickupPoint: string;
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
  /** Enviado ao conectar: diz se a conexão foi autenticada (sem isso o app não recebe eventos da conta). */
  ready: 'realtime.ready',
  /** Pedido criado, pago ou com status alterado: o dono e a equipe recarregam o pedido. */
  orderUpdated: 'order.updated',
  /** Qualquer mudança no mapa de mesas (chamado, ocupação, pagamento, reserva, mescla): a equipe recarrega o mapa. */
  tablesUpdated: 'tables.updated',
} as const;

export type RealtimeEvent = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

/** Sala que o cliente pode assinar; salas de equipe e de usuário são atribuídas pelo servidor. */
export interface RealtimeSubscribeRequest {
  restaurantId?: string;
  establishmentId?: string;
}

export interface RealtimePayload {
  establishmentId?: string;
  orderId?: string;
  /** Só em `realtime.ready`: a conexão tem sessão válida? */
  authenticated?: boolean;
  reason?: string;
}

// ─── QR Code, pedidos e pagamentos (Sprint 2, bloco 1) ──────────────────────

/** Mesa e estabelecimento identificados por um QR Code lido pelo cliente (ficha 02). */
export interface QrResolveDto {
  establishmentId: string;
  establishmentName: string;
  tableId: string;
  tableLabel: string;
  orderingStatus: OrderingStatus;
  acceptingOrders: boolean;
}

export const ORDER_STATUSES = ['received', 'paid', 'preparing', 'ready', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Próximos status que a equipe pode aplicar (o servidor valida a transição). */
export const STAFF_ORDER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus>> = {
  paid: 'preparing',
  preparing: 'ready',
  ready: 'delivered',
};

export const PAYMENT_METHODS = ['pix', 'credit', 'debit'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type PaymentStatus = 'pending' | 'approved' | 'refused' | 'expired' | 'cancelled' | 'refunded';

export const MAX_ORDER_LINE_QUANTITY = 20;
export const MAX_ORDER_LINES = 30;

export interface CreateOrderRequest {
  establishmentId: string;
  tableId?: string;
  /** Identifica a tentativa de checkout: repetir o envio devolve o mesmo pedido. */
  clientRequestId: string;
  /** Total exibido ao cliente; se o servidor calcular outro valor, responde PRICE_CHANGED. */
  expectedTotalCents?: number;
  items: { menuItemId: string; quantity: number; notes?: string }[];
}

export interface OrderItemDto {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  notes: string;
}

export interface PixPaymentDto {
  copyPaste: string;
  qrBase64: string | null;
  expiresAt: string | null;
}

export interface PaymentDto {
  id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountCents: number;
  /** Identificador da transação no gateway (comprovante). */
  transactionId: string | null;
  /** Transação simulada (demonstração): não tem valor financeiro. */
  simulated: boolean;
  pix: PixPaymentDto | null;
  failureReason: string | null;
  approvedAt: string | null;
  refundedAt: string | null;
}

export interface CreatePaymentRequest {
  method: PaymentMethod;
  /** Token do cartão gerado no navegador pelo SDK do gateway (nunca o número do cartão). */
  cardToken?: string;
  /** Bandeira/tipo do cartão informado pelo SDK (ex.: "visa"). */
  paymentMethodId?: string;
  /** Total que o cliente viu; se o pedido tiver outro valor, o servidor recusa (ORDER_TOTAL_CHANGED). */
  expectedTotalCents?: number;
}

export interface OrderDto {
  id: string;
  number: number;
  establishmentId: string;
  establishmentName: string;
  tableId: string | null;
  tableLabel: string | null;
  status: OrderStatus;
  totalCents: number;
  items: OrderItemDto[];
  pickupPoint: string;
  /** Só aparece quando o pedido está pronto ou entregue. */
  pickupCode: string | null;
  /** Estimativa de preparo informada pela casa; some quando o pedido está pronto. */
  estimatedMinutes: number | null;
  payment: PaymentDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffOrderDto extends OrderDto {
  customerName: string;
  /** Estorno pedido ao gateway e ainda sem confirmação: repetir o estorno é seguro. */
  refundPending: boolean;
}

// ─── Sprint 2, blocos 2 e 3 ─────────────────────────────────────────────────

/** Ficha 60: categorias de comida distintas dos estabelecimentos ativos. */
export interface RestaurantCategoriesDto {
  categories: string[];
}

/** Ficha 45. */
export interface FavoritesDto {
  items: RestaurantSummary[];
}
export interface FavoriteIdsDto {
  ids: string[];
}
export interface FavoriteStateDto {
  favorited: boolean;
}

// Ficha 16/47: mapa de mesas.
export type TableState = 'free' | 'occupied' | 'reserved' | 'called';

export interface TableCallDto {
  id: string;
  createdAt: string;
}

export interface TableReservationDto {
  id: string;
  name: string;
  partySize: number;
  reservedAt: string;
}

export interface TableMapTableDto {
  id: string;
  label: string;
  shape: TableShape;
  capacity: number;
  x: number;
  y: number;
  qrCode: string;
  status: TableState;
  partySize: number;
  since: string | null;
  pendingCall: TableCallDto | null;
  reservation: TableReservationDto | null;
  /** Mesa mesclada: id do grupo (ficha 47). */
  groupId: string | null;
}

/** Mesas mescladas aparecem como uma unidade (capacidade somada). */
export interface TableMapGroupDto {
  id: string;
  tableIds: string[];
  label: string;
  capacity: number;
  x: number;
  y: number;
  status: TableState;
  partySize: number;
  since: string | null;
  pendingCall: TableCallDto | null;
  reservation: TableReservationDto | null;
}

export interface TableMapDto {
  establishmentId: string;
  tables: TableMapTableDto[];
  groups: TableMapGroupDto[];
}

export interface CreatedTableCallDto {
  id: string;
  tableId: string;
  createdAt: string;
}

export interface TableCheckOrderDto {
  id: string;
  number: number;
  tableLabel: string | null;
  status: OrderStatus;
  totalCents: number;
  items: OrderItemDto[];
}

/** Conta consolidada de uma mesa ou de um grupo de mesas mescladas. */
export interface TableCheckDto {
  tableIds: string[];
  label: string;
  orders: TableCheckOrderDto[];
  totalCents: number;
  paidCents: number;
}

// Ficha 61.
export interface LayoutDuplicationTargetDto {
  id: string;
  name: string;
  tableCount: number;
  eligible: boolean;
  reason: string | null;
}

// Ficha 46.
export interface MenuRankingItemDto {
  menuItemId: string;
  name: string;
  quantity: number;
  rank: number;
  highlighted: boolean;
}
export interface MenuRankingDto {
  calculatedAt: string | null;
  items: MenuRankingItemDto[];
}

// Ficha 59: WebAuthn. `options`/`response` seguem o formato JSON do WebAuthn (@simplewebauthn).
export interface WebAuthnOptionsDto {
  challengeId: string;
  options: Record<string, unknown>;
}
export interface PasskeyDto {
  id: string;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
}
