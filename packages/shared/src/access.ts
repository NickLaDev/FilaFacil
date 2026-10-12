// Catálogo único de papéis, permissões e recursos de plano. A API usa as chaves para autorizar;
// o frontend usa os rótulos para exibir. Mudar uma chave aqui exige rever os dados já gravados.

export const USER_ROLES = ['client', 'attendant', 'manager', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  client: 'Cliente',
  attendant: 'Atendente',
  manager: 'Gestor',
  admin: 'Admin',
};

/** Papéis que trabalham dentro de um estabelecimento (exigem vínculo/membership). */
export const STAFF_ROLES: readonly UserRole[] = ['attendant', 'manager'];

export const USER_STATUSES = ['active', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * `establishment`: vale dentro dos estabelecimentos aos quais o usuário está vinculado.
 * `platform`: vale para a plataforma inteira (somente admins).
 */
export const PERMISSIONS = [
  { key: 'orders.place', label: 'Fazer pedidos', scope: 'client' },
  { key: 'tables.view', label: 'Ver mapa de mesas', scope: 'establishment' },
  { key: 'menu.availability', label: 'Alterar disponibilidade do cardápio', scope: 'establishment' },
  { key: 'menu.edit', label: 'Cadastrar e editar cardápio', scope: 'establishment' },
  { key: 'promotions.manage', label: 'Gerenciar promoções', scope: 'establishment' },
  { key: 'recipes.manage', label: 'Gerenciar fichas técnicas', scope: 'establishment' },
  { key: 'floor.manage', label: 'Editar planta do salão', scope: 'establishment' },
  { key: 'waitlist.manage', label: 'Gerenciar fila de espera', scope: 'establishment' },
  { key: 'orders.manage', label: 'Acompanhar e atualizar pedidos', scope: 'establishment' },
  { key: 'orders.refund', label: 'Estornar pagamentos de pedidos', scope: 'establishment' },
  { key: 'platform.establishments', label: 'Gerenciar estabelecimentos', scope: 'platform' },
  { key: 'platform.users', label: 'Gerenciar usuários', scope: 'platform' },
  { key: 'platform.plans', label: 'Gerenciar planos', scope: 'platform' },
] as const;

export type Permission = (typeof PERMISSIONS)[number]['key'];
export const PERMISSION_KEYS = PERMISSIONS.map(p => p.key) as Permission[];

export const isPermission = (value: string): value is Permission => (PERMISSION_KEYS as string[]).includes(value);

export const permissionLabel = (key: string) => PERMISSIONS.find(p => p.key === key)?.label ?? key;

export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, Permission[]> = {
  client: ['orders.place'],
  attendant: ['tables.view', 'menu.availability', 'orders.manage'],
  manager: ['tables.view', 'menu.availability', 'menu.edit', 'promotions.manage', 'recipes.manage', 'floor.manage', 'waitlist.manage', 'orders.manage', 'orders.refund'],
  admin: ['platform.establishments', 'platform.users', 'platform.plans'],
};

export const PLAN_FEATURES = ['floor_plan', 'waitlist', 'promotions', 'recipes', 'layout_duplication'] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  floor_plan: 'Planta do salão',
  waitlist: 'Fila de espera',
  promotions: 'Promoções e descontos',
  recipes: 'Fichas técnicas',
  layout_duplication: 'Duplicar layout entre unidades',
};

/** Limites a partir deste valor são exibidos como "Ilimitado". */
export const UNLIMITED = 999;

export const ESTABLISHMENT_STATUSES = ['active', 'inactive', 'suspended'] as const;
export type EstablishmentStatus = (typeof ESTABLISHMENT_STATUSES)[number];

export const ESTABLISHMENT_TYPES = ['bar', 'restaurant', 'canteen', 'snack_bar'] as const;
export type EstablishmentType = (typeof ESTABLISHMENT_TYPES)[number];

export const ESTABLISHMENT_TYPE_LABELS: Record<EstablishmentType, string> = {
  bar: 'Bar',
  restaurant: 'Restaurante',
  canteen: 'Cantina',
  snack_bar: 'Lanchonete',
};
