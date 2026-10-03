import type { ClientAccount, PermissionChange, PlatformRole, PlatformUser } from '@/types/user';

/** Código aceito pelos fluxos mockados de verificação (OTP, recuperação, exclusão). */
export const DEMO_VERIFICATION_CODE = '123456';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

export const CLIENT_ACCOUNTS: ClientAccount[] = [
  {
    id: 'acc-demo',
    name: 'João Silva',
    cpfMasked: '***.***.247-25',
    cpfFingerprint: '7281dfb5e8becca0a1c5e77c1268baacb0f983572b8c204fd8df72b24175b231',
    email: 'joao@email.com',
    phone: '(19) 99999-9999',
    emailVerified: true,
    phoneVerified: true,
    addresses: [
      { id: 'a1', label: 'Casa', street: 'Rua das Acácias, 123', city: 'Campinas, SP', isDefault: true },
      { id: 'a2', label: 'Trabalho', street: 'Av. Universitária, 450', city: 'Barão Geraldo, SP', isDefault: false },
    ],
    favoriteEstablishmentIds: ['r2', 'r4'],
    createdAt: daysAgo(120),
  },
];

/** Usuário logado em cada painel enquanto não há login de equipe (fora do escopo das Sprints 1–2). */
export const CURRENT_STAFF_USER_ID = {
  attendant: 'u2',
  manager: 'u1',
  admin: 'u10',
} as const;

export const ROLE_LABELS: Record<PlatformRole, string> = {
  client: 'Cliente',
  attendant: 'Atendente',
  manager: 'Gestor',
  admin: 'Admin',
};

export const PERMISSIONS: { id: string; label: string }[] = [
  { id: 'orders.place', label: 'Fazer pedidos' },
  { id: 'tables.view', label: 'Ver mapa de mesas' },
  { id: 'menu.availability', label: 'Alterar disponibilidade do cardápio' },
  { id: 'menu.edit', label: 'Cadastrar e editar cardápio' },
  { id: 'promotions.manage', label: 'Gerenciar promoções' },
  { id: 'recipes.manage', label: 'Gerenciar fichas técnicas' },
  { id: 'floor.manage', label: 'Editar planta do salão' },
  { id: 'waitlist.manage', label: 'Gerenciar fila de espera' },
  { id: 'platform.establishments', label: 'Gerenciar estabelecimentos' },
  { id: 'platform.users', label: 'Gerenciar usuários' },
  { id: 'platform.plans', label: 'Gerenciar planos' },
];

export const ROLE_DEFAULT_PERMISSIONS: Record<PlatformRole, string[]> = {
  client: ['orders.place'],
  attendant: ['tables.view', 'menu.availability'],
  manager: ['tables.view', 'menu.availability', 'menu.edit', 'promotions.manage', 'recipes.manage', 'floor.manage', 'waitlist.manage'],
  admin: ['platform.establishments', 'platform.users', 'platform.plans'],
};

export const PLATFORM_USERS: PlatformUser[] = [
  { id: 'u1', name: 'Lucas Torres', email: 'lucas@bardomestre.com.br', role: 'manager', permissions: ROLE_DEFAULT_PERMISSIONS.manager, status: 'active', establishmentId: 'r1', lastAccess: 'Agora' },
  { id: 'u2', name: 'Carlos Mendes', email: 'carlos@bardomestre.com.br', role: 'attendant', permissions: ROLE_DEFAULT_PERMISSIONS.attendant, status: 'active', establishmentId: 'r1', lastAccess: 'Hoje, 20:14' },
  { id: 'u3', name: 'Ana Rodrigues', email: 'ana@bardomestre.com.br', role: 'attendant', permissions: ROLE_DEFAULT_PERMISSIONS.attendant, status: 'active', establishmentId: 'r1', lastAccess: 'Hoje, 19:58' },
  { id: 'u4', name: 'Mariana Costa', email: 'mariana@bardomestre.com.br', role: 'attendant', permissions: ROLE_DEFAULT_PERMISSIONS.attendant, status: 'suspended', establishmentId: 'r1', lastAccess: '25 ago, 21:00' },
  { id: 'u5', name: 'Fernanda Costa', email: 'fernanda@belavista.com.br', role: 'manager', permissions: ROLE_DEFAULT_PERMISSIONS.manager, status: 'active', establishmentId: 'r10', lastAccess: 'há 3 dias' },
  { id: 'u6', name: 'João Silva', email: 'joao@email.com', role: 'client', permissions: ROLE_DEFAULT_PERMISSIONS.client, status: 'active', lastAccess: 'há 2h' },
  { id: 'u7', name: 'Marina Silva', email: 'marina.s@gmail.com', role: 'client', permissions: ROLE_DEFAULT_PERMISSIONS.client, status: 'active', lastAccess: 'há 5h' },
  { id: 'u8', name: 'Pedro Carvalho', email: 'pedro.c@hotmail.com', role: 'client', permissions: ROLE_DEFAULT_PERMISSIONS.client, status: 'active', lastAccess: 'Ontem' },
  { id: 'u9', name: 'Joana Ferreira', email: 'joana.f@gmail.com', role: 'client', permissions: ROLE_DEFAULT_PERMISSIONS.client, status: 'suspended', lastAccess: 'há 45 dias' },
  { id: 'u10', name: 'Admin FilaZero', email: 'admin@filazero.app', role: 'admin', permissions: ROLE_DEFAULT_PERMISSIONS.admin, status: 'active', lastAccess: 'Agora' },
];

export const PERMISSION_HISTORY: PermissionChange[] = [
  { id: 'ph1', userId: 'u4', userName: 'Mariana Costa', description: 'Usuário suspenso', actor: 'Admin FilaZero', at: daysAgo(8) },
  { id: 'ph2', userId: 'u2', userName: 'Carlos Mendes', description: 'Papel alterado de Cliente para Atendente', actor: 'Admin FilaZero', at: daysAgo(30) },
];
