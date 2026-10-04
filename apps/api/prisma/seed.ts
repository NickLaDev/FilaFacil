/**
 * Seed de desenvolvimento (idempotente): IDs fixos + upsert. Rodar de novo restaura os dados de
 * demonstração sem apagar o que foi criado pela interface. Credenciais documentadas no README.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { ROLE_DEFAULT_PERMISSIONS, type PlanFeature, type UserRole } from '@filafacil/shared';
import { AppConfig } from '../src/config/app-config.js';
import { parseEnv } from '../src/config/env.js';
import { Prisma, PrismaClient, type EstablishmentStatus, type EstablishmentType, type IngredientUnit, type TableShape } from '../src/generated/prisma/client.js';
import { CpfProtector } from '../src/modules/auth/cpf-protector.service.js';
import { PasswordHasher } from '../src/modules/auth/password-hasher.service.js';

const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const config = new AppConfig(parseEnv(process.env));
if (config.isProduction && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
  throw new Error('Seed de desenvolvimento bloqueado em produção (contas com senha conhecida).');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.env.DATABASE_URL }) });
const cpf = new CpfProtector(config);
const passwords = new PasswordHasher();

/** Senha de todas as contas de demonstração (somente desenvolvimento). */
export const DEV_PASSWORD = 'FilaFacil123';

// ─── IDs fixos (UUID v4 válidos) ────────────────────────────────────────────
const id = (namespace: number, n: number) => `${String(namespace).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const SEED_IDS = {
  plan: { start: id(3, 1), pro: id(3, 2), business: id(3, 3) },
  establishment: (n: number) => id(1, n),
  organization: (n: number) => id(4, n),
  user: (n: number) => id(5, n),
  item: (n: number) => id(6, n),
  table: (n: number) => id(2, n),
};

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const now = Date.now();
const at = (offsetMs: number) => new Date(now + offsetMs);
const unsplash = (photo: string, w = 600, h = 300) => `https://images.unsplash.com/photo-${photo}?w=${w}&h=${h}&fit=crop&auto=format`;
const minutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Centro de Campinas: localização padrão do cliente sem GPS (mesma do frontend). */
const CENTER = { lat: -22.9056, lng: -47.0608 };

// ─── Planos e organizações ──────────────────────────────────────────────────
const PLANS: { id: string; name: string; price: number; units: number; tables: number; staff: number; features: PlanFeature[] }[] = [
  { id: SEED_IDS.plan.start, name: 'Start', price: 9900, units: 1, tables: 15, staff: 5, features: ['floor_plan', 'waitlist'] },
  { id: SEED_IDS.plan.pro, name: 'Pro', price: 29900, units: 3, tables: 40, staff: 20, features: ['floor_plan', 'waitlist', 'promotions', 'recipes'] },
  {
    id: SEED_IDS.plan.business,
    name: 'Business',
    price: 79900,
    units: 999,
    tables: 999,
    staff: 999,
    features: ['floor_plan', 'waitlist', 'promotions', 'recipes', 'layout_duplication'],
  },
];

const ORGANIZATIONS = [
  'Grupo Bar do Mestre',
  'Seu Joaquim Bar Ltda',
  'Cantina Universitária',
  'Boteco da Vila',
  'Grupo do Zé',
  'Kazu Gastronomia',
  'Restaurantes Bela Vista',
].map((name, index) => ({ id: SEED_IDS.organization(index + 1), name }));

// ─── Estabelecimentos ───────────────────────────────────────────────────────
interface EstablishmentSeed {
  n: number;
  name: string;
  org: number;
  plan: string;
  status: EstablishmentStatus;
  type: EstablishmentType;
  city: string;
  address: string;
  offset: [number, number];
  absolute?: [number, number];
  hours: { days: number[]; opens: string; closes: string }[];
  rating: number;
  ratingCount: number;
  wait: number;
  paused?: boolean;
  highDemand?: boolean;
  foodCategories: string[];
  tags: string[];
  photos: string[];
  createdAt: string;
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const PHOTOS = {
  mestre: unsplash('1514933651103-005eec06c04b'),
  joaquim: unsplash('1575444758702-4a6b9222336e'),
  cantina: unsplash('1517248135467-4c7edcad34c4'),
  vila: unsplash('1555396273-367ea4eb4db5'),
  lanche: unsplash('1565299507177-b0ac66763828'),
  ze: unsplash('1541532713592-79a0317b6b77'),
  sushi: unsplash('1579871494447-9811cf80d66c'),
  salao: unsplash('1559339352-11d035aa65de'),
  balcao: unsplash('1572116469696-31de0f17cc34'),
  drinks: unsplash('1470337458703-46ad1756a187'),
};

const ESTABLISHMENTS: EstablishmentSeed[] = [
  {
    n: 1, name: 'Bar do Mestre', org: 1, plan: SEED_IDS.plan.business, status: 'active', type: 'bar', city: 'Campinas',
    address: 'Rua das Flores, 148 · Centro', offset: [0.003, 0.0012], hours: [{ days: EVERY_DAY, opens: '10:00', closes: '02:00' }],
    rating: 4.7, ratingCount: 312, wait: 12, foodCategories: ['Bar', 'Petiscos'], tags: ['Cervejas artesanais', 'Petiscos'],
    photos: [PHOTOS.mestre, PHOTOS.balcao, PHOTOS.drinks], createdAt: '2025-03-12',
  },
  {
    n: 2, name: 'Seu Joaquim Bar', org: 2, plan: SEED_IDS.plan.pro, status: 'active', type: 'bar', city: 'Campinas',
    address: 'Av. Brasil, 512 · Barão Geraldo', offset: [-0.006, 0.005], hours: [{ days: EVERY_DAY, opens: '11:00', closes: '01:00' }],
    rating: 4.3, ratingCount: 189, wait: 25, highDemand: true, foodCategories: ['Bar', 'Brasileira'], tags: ['Chopes', 'Botequim'],
    photos: [PHOTOS.joaquim, PHOTOS.salao], createdAt: '2025-05-02',
  },
  {
    n: 3, name: 'Cantina Universitária', org: 3, plan: SEED_IDS.plan.start, status: 'active', type: 'canteen', city: 'Campinas',
    address: 'Campus Unicamp · Cidade Universitária', offset: [0.008, -0.008], hours: [{ days: WEEKDAYS, opens: '11:00', closes: '14:00' }],
    rating: 4.5, ratingCount: 421, wait: 15, foodCategories: ['Brasileira', 'Lanches'], tags: ['Almoço', 'Lanches'],
    photos: [PHOTOS.cantina], createdAt: '2025-02-20',
  },
  {
    n: 4, name: 'Boteco da Vila', org: 4, plan: SEED_IDS.plan.start, status: 'active', type: 'bar', city: 'Campinas',
    address: 'Rua da Vila, 88 · Jardim das Flores', offset: [-0.0045, -0.0035], hours: [{ days: EVERY_DAY, opens: '11:00', closes: '00:00' }],
    rating: 4.6, ratingCount: 256, wait: 10, foodCategories: ['Bar', 'Petiscos'], tags: ['Rodízio de petiscos', 'Happy Hour'],
    photos: [PHOTOS.vila, PHOTOS.salao], createdAt: '2025-07-01',
  },
  {
    n: 5, name: 'Lancheria do Zé', org: 5, plan: SEED_IDS.plan.pro, status: 'active', type: 'snack_bar', city: 'Campinas',
    address: 'Rua 7 de Setembro, 203', offset: [0.001, -0.004], hours: [{ days: EVERY_DAY, opens: '08:00', closes: '23:30' }],
    rating: 4.4, ratingCount: 178, wait: 8, foodCategories: ['Hambúrguer', 'Lanches'], tags: ['Hambúrgueres', 'Combos'],
    photos: [PHOTOS.lanche], createdAt: '2025-04-18',
  },
  {
    n: 6, name: 'Bar do Zé', org: 5, plan: SEED_IDS.plan.pro, status: 'active', type: 'bar', city: 'Campinas',
    address: 'Rua Augusta, 742 · Centro', offset: [-0.0015, 0.0014], hours: [{ days: EVERY_DAY, opens: '10:00', closes: '02:00' }],
    rating: 4.8, ratingCount: 512, wait: 15, paused: true, foodCategories: ['Bar', 'Petiscos'], tags: ['Cervejas', 'Petiscos', 'Happy Hour'],
    photos: [PHOTOS.ze, PHOTOS.balcao], createdAt: '2025-04-18',
  },
  {
    n: 7, name: 'Bar do Mestre 2', org: 1, plan: SEED_IDS.plan.business, status: 'active', type: 'bar', city: 'Campinas',
    address: 'Av. Norte-Sul, 1200 · Bairro Novo', offset: [0.02, 0.01], hours: [{ days: EVERY_DAY, opens: '11:00', closes: '01:00' }],
    rating: 4.5, ratingCount: 64, wait: 18, foodCategories: ['Bar', 'Hambúrguer'], tags: ['Hambúrgueres', 'Chopes'],
    photos: [PHOTOS.salao, PHOTOS.drinks], createdAt: '2026-06-10',
  },
  {
    n: 8, name: 'Bar do Mestre Express', org: 1, plan: SEED_IDS.plan.business, status: 'inactive', type: 'bar', city: 'Campinas',
    address: 'Shopping Parque · Piso L2', offset: [-0.025, -0.015], hours: [{ days: EVERY_DAY, opens: '12:00', closes: '22:00' }],
    rating: 0, ratingCount: 0, wait: 10, foodCategories: ['Bar'], tags: ['Express'], photos: [PHOTOS.balcao], createdAt: '2026-08-30',
  },
  {
    n: 9, name: 'Sushi Kazu', org: 6, plan: SEED_IDS.plan.pro, status: 'active', type: 'restaurant', city: 'Campinas',
    address: 'Rua Coronel Quirino, 980 · Cambuí', offset: [0.011, 0.009], hours: [{ days: EVERY_DAY, opens: '11:30', closes: '23:30' }],
    rating: 4.6, ratingCount: 230, wait: 20, foodCategories: ['Japonesa'], tags: ['Sushi', 'Temaki'], photos: [PHOTOS.sushi, PHOTOS.salao], createdAt: '2025-11-05',
  },
  {
    n: 10, name: 'Restaurante São Paulo', org: 7, plan: SEED_IDS.plan.pro, status: 'suspended', type: 'restaurant', city: 'São Paulo',
    address: 'Av. Paulista, 1500 · Bela Vista', offset: [0, 0], absolute: [-23.5614, -46.6559], hours: [{ days: EVERY_DAY, opens: '11:00', closes: '23:00' }],
    rating: 4.1, ratingCount: 98, wait: 25, foodCategories: ['Brasileira'], tags: ['Executivo'], photos: [PHOTOS.salao], createdAt: '2025-01-15',
  },
];

// ─── Usuários ───────────────────────────────────────────────────────────────
/** Gera um CPF válido a partir dos 9 primeiros dígitos (dados fictícios de teste). */
function cpfFrom(base: string) {
  const digits = base.split('').map(Number);
  for (const length of [9, 10]) {
    const sum = digits.slice(0, length).reduce((acc, digit, index) => acc + digit * (length + 1 - index), 0);
    const rest = (sum * 10) % 11;
    digits.push(rest === 10 ? 0 : rest);
  }
  return digits.join('');
}

interface UserSeed {
  n: number;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  suspended?: boolean;
  cpfBase?: string;
  establishments?: number[];
  lastAccess?: number;
}

const USERS: UserSeed[] = [
  { n: 1, name: 'Admin FilaZero', email: 'admin@filazero.app', role: 'admin', lastAccess: 0 },
  { n: 2, name: 'Lucas Torres', email: 'lucas@bardomestre.com.br', role: 'manager', establishments: [1, 7, 8], lastAccess: 5 * MINUTE },
  { n: 3, name: 'Carlos Mendes', email: 'carlos@bardomestre.com.br', role: 'attendant', establishments: [1], lastAccess: 40 * MINUTE },
  { n: 4, name: 'Ana Rodrigues', email: 'ana@bardomestre.com.br', role: 'attendant', establishments: [1], lastAccess: 2 * 60 * MINUTE },
  { n: 5, name: 'Mariana Costa', email: 'mariana@bardomestre.com.br', role: 'attendant', establishments: [1], suspended: true, lastAccess: 9 * DAY },
  { n: 6, name: 'Fernanda Costa', email: 'fernanda@belavista.com.br', role: 'manager', establishments: [10], lastAccess: 3 * DAY },
  { n: 7, name: 'Paula Nunes', email: 'paula@cantina.edu.br', role: 'manager', establishments: [3], lastAccess: DAY },
  { n: 8, name: 'José Almeida', email: 'ze@grupodoze.com.br', role: 'manager', establishments: [5, 6], lastAccess: 6 * 60 * MINUTE },
  { n: 10, name: 'João Silva', email: 'joao@email.com', phone: '19999999999', role: 'client', cpfBase: '529982247', lastAccess: 2 * 60 * MINUTE },
  { n: 11, name: 'Marina Silva', email: 'marina.s@gmail.com', phone: '19987654321', role: 'client', cpfBase: '111444777', lastAccess: 5 * 60 * MINUTE },
  { n: 12, name: 'Pedro Carvalho', email: 'pedro.c@hotmail.com', role: 'client', cpfBase: '987654321', lastAccess: DAY },
  { n: 13, name: 'Joana Ferreira', email: 'joana.f@gmail.com', role: 'client', cpfBase: '123456789', suspended: true, lastAccess: 45 * DAY },
];

// ─── Cardápio ───────────────────────────────────────────────────────────────
const CATEGORY_ORDER = ['Cervejas', 'Drinks', 'Porções', 'Lanches', 'Combos', 'Japonesa'];
const food = (photo: string) => unsplash(photo, 400, 300);

interface ItemSeed {
  n: number;
  est: number;
  name: string;
  description: string;
  price: number;
  category: string;
  photo: string;
  available?: boolean;
}

const ITEMS: ItemSeed[] = [
  { n: 1, est: 1, name: 'Cerveja IPA 600ml', description: 'Artesanal com notas cítricas e amargor equilibrado', price: 1890, category: 'Cervejas', photo: '1608270586620-248524c67de9' },
  { n: 2, est: 1, name: 'X-Burger', description: 'Hambúrguer artesanal 180g, alface, tomate, cheddar e maionese especial', price: 2890, category: 'Lanches', photo: '1568901346375-23c9450c58cd' },
  { n: 3, est: 1, name: 'Caipirinha de Limão', description: 'Cachaça premium, limão siciliano e açúcar cristal', price: 2200, category: 'Drinks', photo: '1551538827-9c037cb4f32a' },
  { n: 4, est: 1, name: 'Batata Frita', description: 'Porção 400g crocante com molho aïoli', price: 2200, category: 'Porções', photo: '1573080496219-bb080dd4f877' },
  { n: 5, est: 1, name: 'X-Bacon', description: 'Hambúrguer com bacon crocante, queijo e cebola caramelizada', price: 3290, category: 'Lanches', photo: '1553979459-d2229ba7433b', available: false },
  { n: 6, est: 1, name: 'Heineken Long Neck', description: 'Cerveja holandesa 330ml gelada', price: 1290, category: 'Cervejas', photo: '1535958636474-b021ee887b13' },
  { n: 7, est: 1, name: 'Combo IPA + X-Burger', description: 'Cerveja IPA 600ml + X-Burger com batata pequena', price: 4200, category: 'Combos', photo: '1594212699903-ec8a3eca50f5' },
  { n: 8, est: 1, name: 'Gin Tônica', description: 'Gin premium, água tônica, pepino e pimenta rosa', price: 2800, category: 'Drinks', photo: '1514362545857-3bc16c4c7d1b' },
  { n: 9, est: 1, name: 'Porção de Coxinha', description: 'Bandeja com 12 unidades, frango desfiado e catupiry', price: 3500, category: 'Porções', photo: '1604909052743-94e838986d24' },
  { n: 10, est: 4, name: 'Chopp Pilsen 300ml', description: 'Chopp claro, leve e bem gelado', price: 990, category: 'Cervejas', photo: '1608270586620-248524c67de9' },
  { n: 11, est: 4, name: 'Porção de Coxinha', description: 'Bandeja com 10 unidades de frango com catupiry', price: 2900, category: 'Porções', photo: '1604909052743-94e838986d24' },
  { n: 12, est: 4, name: 'Batata com Cheddar', description: 'Batata frita com cheddar cremoso e bacon', price: 2700, category: 'Porções', photo: '1573080496219-bb080dd4f877' },
  { n: 13, est: 5, name: 'X-Salada', description: 'Hambúrguer 150g, queijo, alface e tomate', price: 2490, category: 'Lanches', photo: '1568901346375-23c9450c58cd' },
  { n: 14, est: 5, name: 'X-Bacon Duplo', description: 'Dois hambúrgueres, bacon crocante e cheddar', price: 3490, category: 'Lanches', photo: '1553979459-d2229ba7433b' },
  { n: 15, est: 5, name: 'Combo Lanche + Refri', description: 'X-Salada, batata pequena e refrigerante lata', price: 3600, category: 'Combos', photo: '1594212699903-ec8a3eca50f5' },
  { n: 16, est: 2, name: 'Chopp Brahma 500ml', description: 'Chopp tradicional tirado na pressão', price: 1490, category: 'Cervejas', photo: '1608270586620-248524c67de9' },
  { n: 17, est: 2, name: 'Mandioca Frita', description: 'Porção com manteiga de garrafa', price: 2600, category: 'Porções', photo: '1573080496219-bb080dd4f877' },
  { n: 18, est: 9, name: 'Combo Sushi 20 peças', description: 'Seleção do chef com salmão, atum e skin', price: 7900, category: 'Japonesa', photo: '1579871494447-9811cf80d66c' },
  { n: 19, est: 9, name: 'Temaki de Salmão', description: 'Salmão fresco, cream cheese e cebolinha', price: 3200, category: 'Japonesa', photo: '1617196034796-73dfa7b1fd56' },
  { n: 20, est: 7, name: 'Smash Burger', description: 'Dois smash 90g, cheddar e cebola na chapa', price: 3100, category: 'Lanches', photo: '1568901346375-23c9450c58cd' },
];

// ─── Fichas técnicas (Bar do Mestre) ────────────────────────────────────────
const INGREDIENTS: { n: number; name: string; unit: IngredientUnit; cost: string }[] = [
  { n: 1, name: 'Pão de hambúrguer', unit: 'un', cost: '1.20' },
  { n: 2, name: 'Hambúrguer 180g', unit: 'un', cost: '7.20' },
  { n: 3, name: 'Queijo cheddar (fatia)', unit: 'un', cost: '0.90' },
  { n: 4, name: 'Molho especial', unit: 'g', cost: '0.06' },
  { n: 5, name: 'Batata congelada', unit: 'kg', cost: '9.33' },
  { n: 6, name: 'Óleo de fritura', unit: 'L', cost: '24.00' },
  { n: 7, name: 'Cerveja IPA 600ml', unit: 'un', cost: '6.40' },
  { n: 8, name: 'Gin', unit: 'ml', cost: '0.12' },
  { n: 9, name: 'Água tônica', unit: 'ml', cost: '0.0134' },
  { n: 10, name: 'Limão', unit: 'un', cost: '1.60' },
  { n: 11, name: 'Cachaça premium', unit: 'ml', cost: '0.06' },
  { n: 12, name: 'Açúcar cristal', unit: 'g', cost: '0.01' },
];

const SHEETS: { item: number; limit: string; lines: [number, string][] }[] = [
  { item: 2, limit: '35', lines: [[1, '1'], [2, '1'], [3, '2'], [4, '20']] },
  { item: 4, limit: '30', lines: [[5, '0.4'], [6, '0.05']] },
  { item: 1, limit: '35', lines: [[7, '1']] },
  { item: 8, limit: '35', lines: [[8, '50'], [9, '150'], [10, '0.5']] },
  { item: 3, limit: '30', lines: [[11, '60'], [10, '1'], [12, '20']] },
];

// ─── Salão ──────────────────────────────────────────────────────────────────
interface TableSeed {
  n: number;
  est: number;
  label: string;
  shape: TableShape;
  capacity: number;
  x: number;
  y: number;
  qr: string;
  occupied?: number;
  sinceMin?: number;
}

const TABLES: TableSeed[] = [
  { n: 1, est: 1, label: 'Mesa 1', shape: 'round', capacity: 2, x: 12, y: 18, qr: 'MESTRE-1041' },
  { n: 2, est: 1, label: 'Mesa 2', shape: 'round', capacity: 2, x: 30, y: 18, qr: 'MESTRE-2087', occupied: 2, sinceMin: 42 },
  { n: 3, est: 1, label: 'Mesa 3', shape: 'round', capacity: 2, x: 48, y: 18, qr: 'MESTRE-3112', occupied: 2, sinceMin: 18 },
  { n: 4, est: 1, label: 'Mesa 4', shape: 'round', capacity: 2, x: 66, y: 18, qr: 'MESTRE-4250', occupied: 2, sinceMin: 5 },
  { n: 5, est: 1, label: 'Mesa 5', shape: 'square', capacity: 4, x: 12, y: 48, qr: 'MESTRE-5379' },
  { n: 6, est: 1, label: 'Mesa 6', shape: 'square', capacity: 4, x: 30, y: 48, qr: 'MESTRE-6403', occupied: 3, sinceMin: 55 },
  { n: 7, est: 1, label: 'Mesa 7', shape: 'square', capacity: 4, x: 48, y: 48, qr: 'MESTRE-7531', occupied: 4, sinceMin: 25 },
  { n: 8, est: 1, label: 'Mesa 8', shape: 'square', capacity: 4, x: 66, y: 48, qr: 'MESTRE-8664' },
  { n: 9, est: 1, label: 'Mesa 9', shape: 'rect', capacity: 6, x: 16, y: 80, qr: 'MESTRE-9718', occupied: 6, sinceMin: 102 },
  { n: 10, est: 1, label: 'Mesa 10', shape: 'rect', capacity: 6, x: 42, y: 80, qr: 'MESTRE-1095' },
  { n: 11, est: 1, label: 'Mesa 11', shape: 'rect', capacity: 6, x: 68, y: 80, qr: 'MESTRE-1126', occupied: 6, sinceMin: 3 },
  { n: 12, est: 1, label: 'Mesa 12', shape: 'square', capacity: 4, x: 88, y: 30, qr: 'MESTRE-1283', occupied: 3, sinceMin: 71 },
  { n: 21, est: 3, label: 'Mesa 1', shape: 'rect', capacity: 6, x: 30, y: 50, qr: 'CANTINA-1201' },
  { n: 22, est: 3, label: 'Mesa 2', shape: 'rect', capacity: 6, x: 70, y: 50, qr: 'CANTINA-2302' },
  { n: 31, est: 8, label: 'Mesa 1', shape: 'round', capacity: 2, x: 25, y: 35, qr: 'EXPRESS-1150' },
  { n: 32, est: 8, label: 'Mesa 2', shape: 'round', capacity: 2, x: 50, y: 35, qr: 'EXPRESS-2261' },
  { n: 33, est: 8, label: 'Mesa 3', shape: 'square', capacity: 4, x: 25, y: 70, qr: 'EXPRESS-3372' },
  { n: 34, est: 8, label: 'Mesa 4', shape: 'square', capacity: 4, x: 50, y: 70, qr: 'EXPRESS-4483' },
];

async function seedPlansAndOrganizations() {
  for (const plan of PLANS) {
    const data = { name: plan.name, monthlyPriceCents: plan.price, maxUnits: plan.units, maxTables: plan.tables, maxStaff: plan.staff };
    await prisma.plan.upsert({ where: { id: plan.id }, create: { id: plan.id, ...data }, update: data });
    await prisma.planFeatureGrant.deleteMany({ where: { planId: plan.id } });
    await prisma.planFeatureGrant.createMany({ data: plan.features.map(feature => ({ planId: plan.id, feature })) });
  }
  for (const organization of ORGANIZATIONS) {
    await prisma.organization.upsert({ where: { id: organization.id }, create: organization, update: { name: organization.name } });
  }
}

async function seedEstablishments() {
  for (const e of ESTABLISHMENTS) {
    const establishmentId = SEED_IDS.establishment(e.n);
    const [latitude, longitude] = e.absolute ?? [CENTER.lat + e.offset[0], CENTER.lng + e.offset[1]];
    const data = {
      name: e.name,
      organizationId: SEED_IDS.organization(e.org),
      planId: e.plan,
      status: e.status,
      type: e.type,
      city: e.city,
      address: e.address,
      latitude,
      longitude,
      timezone: 'America/Sao_Paulo',
      foodCategories: e.foodCategories,
      tags: e.tags,
      ratingAverage: new Prisma.Decimal(e.rating),
      ratingCount: e.ratingCount,
      averageWaitMinutes: e.wait,
      ordersPaused: e.paused ?? false,
      highDemand: e.highDemand ?? false,
    };
    await prisma.establishment.upsert({
      where: { id: establishmentId },
      create: { id: establishmentId, ...data, createdAt: new Date(`${e.createdAt}T12:00:00Z`) },
      update: data,
    });
    await prisma.openingHour.deleteMany({ where: { establishmentId } });
    await prisma.openingHour.createMany({
      data: e.hours.flatMap(range => range.days.map(weekday => ({ establishmentId, weekday, opensAt: minutes(range.opens), closesAt: minutes(range.closes) }))),
    });
    await prisma.establishmentPhoto.deleteMany({ where: { establishmentId, storageKey: null } });
    await prisma.establishmentPhoto.createMany({ data: e.photos.map((url, index) => ({ establishmentId, url, position: index + 1 })) });
  }
}

async function seedUsers() {
  const passwordHash = await passwords.hash(DEV_PASSWORD);
  for (const user of USERS) {
    const userId = SEED_IDS.user(user.n);
    const document = user.cpfBase ? cpfFrom(user.cpfBase) : null;
    const data = {
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      passwordHash,
      role: user.role,
      status: user.suspended ? ('suspended' as const) : ('active' as const),
      emailVerifiedAt: new Date(now - 120 * DAY),
      phoneVerifiedAt: user.phone ? new Date(now - 120 * DAY) : null,
      termsAcceptedAt: new Date(now - 120 * DAY),
      lastAccessAt: user.lastAccess === undefined ? null : at(-user.lastAccess),
      ...(document && { cpfHash: cpf.hash(document), cpfEncrypted: cpf.encrypt(document), cpfMasked: cpf.mask(document) }),
    };
    await prisma.user.upsert({ where: { id: userId }, create: { id: userId, ...data }, update: data });
    await prisma.userPermission.deleteMany({ where: { userId } });
    await prisma.userPermission.createMany({ data: ROLE_DEFAULT_PERMISSIONS[user.role].map(permission => ({ userId, permission })) });
    await prisma.establishmentMembership.deleteMany({ where: { userId } });
    await prisma.establishmentMembership.createMany({
      data: (user.establishments ?? []).map(n => ({ userId, establishmentId: SEED_IDS.establishment(n) })),
    });
  }

  const joao = SEED_IDS.user(10);
  const addresses = [
    { id: id(7, 1), label: 'Casa', street: 'Rua das Acácias, 123', city: 'Campinas, SP', isDefault: true },
    { id: id(7, 2), label: 'Trabalho', street: 'Av. Universitária, 450', city: 'Barão Geraldo, SP', isDefault: false },
  ];
  await prisma.userAddress.updateMany({ where: { userId: joao }, data: { isDefault: false } });
  for (const address of addresses) {
    await prisma.userAddress.upsert({ where: { id: address.id }, create: { ...address, userId: joao }, update: address });
  }

  const admin = SEED_IDS.user(1);
  const audit = [
    { id: id(8, 1), target: 5, action: 'suspended' as const, description: 'Usuário suspenso', before: { status: 'active' }, after: { status: 'suspended' }, ago: 8 * DAY },
    {
      id: id(8, 2), target: 3, action: 'role_changed' as const, description: 'Papel alterado de Cliente para Atendente',
      before: { role: 'client' }, after: { role: 'attendant' }, ago: 30 * DAY,
    },
  ];
  for (const entry of audit) {
    const data = { targetUserId: SEED_IDS.user(entry.target), actorId: admin, action: entry.action, description: entry.description, before: entry.before, after: entry.after, createdAt: at(-entry.ago) };
    await prisma.permissionAuditLog.upsert({ where: { id: entry.id }, create: { id: entry.id, ...data }, update: data });
  }
}

async function seedMenu() {
  for (const est of new Set(ITEMS.map(item => item.est))) {
    const establishmentId = SEED_IDS.establishment(est);
    const categories = CATEGORY_ORDER.filter(name => ITEMS.some(item => item.est === est && item.category === name));
    for (const [index, name] of categories.entries()) {
      await prisma.menuCategory.upsert({
        where: { establishmentId_name: { establishmentId, name } },
        create: { establishmentId, name, position: index + 1 },
        update: { position: index + 1 },
      });
    }
  }
  const categoryIds = new Map(
    (await prisma.menuCategory.findMany({ select: { id: true, name: true, establishmentId: true } })).map(c => [`${c.establishmentId}:${c.name}`, c.id]),
  );
  for (const [index, item] of ITEMS.entries()) {
    const establishmentId = SEED_IDS.establishment(item.est);
    const data = {
      establishmentId,
      categoryId: categoryIds.get(`${establishmentId}:${item.category}`) as string,
      name: item.name,
      description: item.description,
      priceCents: item.price,
      imageUrl: food(item.photo),
      imageStorageKey: null,
      available: item.available ?? true,
      position: index + 1,
      deletedAt: null,
    };
    await prisma.menuItem.upsert({ where: { id: SEED_IDS.item(item.n) }, create: { id: SEED_IDS.item(item.n), ...data }, update: data });
  }

  const historyId = id(9, 1);
  const history = { establishmentId: SEED_IDS.establishment(1), menuItemId: SEED_IDS.item(5), itemName: 'X-Bacon', available: false, changedById: SEED_IDS.user(3), createdAt: at(-40 * MINUTE) };
  await prisma.menuItemAvailabilityChange.upsert({ where: { id: historyId }, create: { id: historyId, ...history }, update: history });

  // Vigências relativas a "agora": rodar o seed de novo mantém uma ativa, uma futura e uma encerrada.
  const promotions = [
    { n: 1, name: 'Happy Hour', items: [3, 8], discount: 20, start: -DAY, end: 7 * DAY },
    { n: 2, name: 'Combo da semana', items: [7], discount: 15, start: -2 * DAY, end: 5 * DAY },
    { n: 3, name: 'Quarta universitária', items: [1, 6], discount: 10, start: -10 * DAY, end: -3 * DAY },
    { n: 4, name: 'Fim de semana da batata', items: [4], discount: 25, start: 2 * DAY, end: 9 * DAY },
  ];
  for (const promotion of promotions) {
    const promotionId = id(10, promotion.n);
    const data = { establishmentId: SEED_IDS.establishment(1), name: promotion.name, discountPercent: promotion.discount, startsAt: at(promotion.start), endsAt: at(promotion.end) };
    await prisma.promotion.upsert({ where: { id: promotionId }, create: { id: promotionId, ...data }, update: data });
    await prisma.promotionItem.deleteMany({ where: { promotionId } });
    await prisma.promotionItem.createMany({ data: promotion.items.map(n => ({ promotionId, menuItemId: SEED_IDS.item(n) })) });
  }

  const establishmentId = SEED_IDS.establishment(1);
  for (const ingredient of INGREDIENTS) {
    const ingredientId = id(11, ingredient.n);
    const data = { establishmentId, name: ingredient.name, unit: ingredient.unit, unitCost: new Prisma.Decimal(ingredient.cost) };
    await prisma.ingredient.upsert({ where: { id: ingredientId }, create: { id: ingredientId, ...data }, update: data });
  }
  for (const [index, sheet] of SHEETS.entries()) {
    const sheetId = id(12, index + 1);
    const data = { menuItemId: SEED_IDS.item(sheet.item), costLimitPercent: new Prisma.Decimal(sheet.limit) };
    await prisma.technicalSheet.upsert({ where: { id: sheetId }, create: { id: sheetId, ...data }, update: data });
    await prisma.technicalSheetItem.deleteMany({ where: { technicalSheetId: sheetId } });
    await prisma.technicalSheetItem.createMany({
      data: sheet.lines.map(([ingredient, quantity]) => ({ technicalSheetId: sheetId, ingredientId: id(11, ingredient), quantity: new Prisma.Decimal(quantity) })),
    });
  }
}

async function seedFloorAndWaitlist() {
  for (const est of new Set(TABLES.map(table => table.est))) {
    const establishmentId = SEED_IDS.establishment(est);
    const planId = id(13, est);
    await prisma.floorPlan.upsert({
      where: { establishmentId },
      create: { id: planId, establishmentId, version: 1, updatedById: SEED_IDS.user(2) },
      update: {},
    });
  }
  const planIds = new Map((await prisma.floorPlan.findMany({ select: { id: true, establishmentId: true } })).map(p => [p.establishmentId, p.id]));
  for (const table of TABLES) {
    const establishmentId = SEED_IDS.establishment(table.est);
    const data = {
      floorPlanId: planIds.get(establishmentId) as string,
      establishmentId,
      label: table.label,
      shape: table.shape,
      capacity: table.capacity,
      positionX: table.x,
      positionY: table.y,
      qrCode: table.qr,
      occupancy: table.occupied ? ('occupied' as const) : ('free' as const),
      occupiedPartySize: table.occupied ?? null,
      occupiedSince: table.sinceMin ? at(-table.sinceMin * MINUTE) : null,
    };
    await prisma.diningTable.upsert({ where: { id: SEED_IDS.table(table.n) }, create: { id: SEED_IDS.table(table.n), ...data }, update: data });
  }

  const establishmentId = SEED_IDS.establishment(1);
  const entries = [
    { n: 1, name: 'Lucas Torres', phone: '19998741234', partySize: 4, ago: 19, quoted: 12 },
    { n: 2, name: 'Marina Silva', phone: '19987654321', partySize: 2, ago: 14, quoted: 12 },
    { n: 3, name: 'João Mendes', phone: '19976543210', partySize: 6, ago: 6, quoted: 24 },
  ];
  // Fecha entradas ativas antigas (fora do seed) para as posições 1..3 ficarem livres.
  await prisma.waitlistEntry.updateMany({
    where: { establishmentId, status: { in: ['waiting', 'notified'] }, id: { notIn: entries.map(entry => id(14, entry.n)) } },
    data: { status: 'removed', closedAt: new Date() },
  });
  // Posições negativas temporárias evitam colisão no índice único se a fila foi reordenada.
  await prisma.waitlistEntry.updateMany({
    where: { id: { in: entries.map(entry => id(14, entry.n)) }, status: { in: ['waiting', 'notified'] } },
    data: { position: { multiply: -1 } },
  });
  for (const entry of entries) {
    const entryId = id(14, entry.n);
    const data = {
      establishmentId,
      name: entry.name,
      phone: entry.phone,
      partySize: entry.partySize,
      position: entry.n,
      status: 'waiting' as const,
      quotedWaitMinutes: entry.quoted,
      joinedAt: at(-entry.ago * MINUTE),
      notifiedAt: null,
      notifiedTableLabel: null,
      notifiedTableIds: [],
      closedAt: null,
      createdById: SEED_IDS.user(2),
    };
    await prisma.waitlistEntry.upsert({ where: { id: entryId }, create: { id: entryId, ...data }, update: data });
  }
}

async function main() {
  await seedPlansAndOrganizations();
  await seedEstablishments();
  await seedUsers();
  await seedMenu();
  await seedFloorAndWaitlist();
  const counts = await Promise.all([
    prisma.establishment.count(),
    prisma.user.count(),
    prisma.menuItem.count({ where: { deletedAt: null } }),
    prisma.diningTable.count(),
  ]);
  console.log(`Seed concluído: ${counts[0]} estabelecimentos, ${counts[1]} usuários, ${counts[2]} itens, ${counts[3]} mesas.`);
  console.log(`Senha das contas de demonstração: ${DEV_PASSWORD} (somente desenvolvimento).`);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
