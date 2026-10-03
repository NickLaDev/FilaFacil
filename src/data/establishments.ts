import type { Establishment, Organization, Plan, PlanFeature } from '@/types/establishment';

const img = (id: string, w = 600, h = 300) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&auto=format`;

const BAR_IMAGES = {
  mestre: img('1514933651103-005eec06c04b'),
  joaquim: img('1575444758702-4a6b9222336e'),
  cantina: img('1517248135467-4c7edcad34c4'),
  vila: img('1555396273-367ea4eb4db5'),
  lanche: img('1565299507177-b0ac66763828'),
  ze: img('1541532713592-79a0317b6b77'),
  sushi: img('1579871494447-9811cf80d66c'),
  salao: img('1559339352-11d035aa65de'),
  balcao: img('1572116469696-31de0f17cc34'),
  drinks: img('1470337458703-46ad1756a187'),
};

export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  'floor-plan': 'Planta do salão',
  waitlist: 'Fila de espera',
  promotions: 'Promoções e descontos',
  recipes: 'Fichas técnicas',
  'layout-duplication': 'Duplicar layout entre unidades',
};

/** Valores ≥ este limite são exibidos como "Ilimitado". */
export const UNLIMITED = 999;

export const PLANS: Plan[] = [
  { id: 'plan-start', name: 'Start', monthlyPrice: 99, limits: { units: 1, tables: 15, staff: 5 }, features: ['floor-plan', 'waitlist'] },
  { id: 'plan-pro', name: 'Pro', monthlyPrice: 299, limits: { units: 3, tables: 40, staff: 20 }, features: ['floor-plan', 'waitlist', 'promotions', 'recipes'] },
  {
    id: 'plan-business',
    name: 'Business',
    monthlyPrice: 799,
    limits: { units: UNLIMITED, tables: UNLIMITED, staff: UNLIMITED },
    features: ['floor-plan', 'waitlist', 'promotions', 'recipes', 'layout-duplication'],
  },
];

export const ORGANIZATIONS: Organization[] = [
  { id: 'org-mestre', name: 'Grupo Bar do Mestre' },
  { id: 'org-joaquim', name: 'Seu Joaquim Bar Ltda' },
  { id: 'org-cantina', name: 'Cantina Universitária' },
  { id: 'org-vila', name: 'Boteco da Vila' },
  { id: 'org-ze', name: 'Grupo do Zé' },
  { id: 'org-kazu', name: 'Kazu Gastronomia' },
  { id: 'org-belavista', name: 'Restaurantes Bela Vista' },
];

export const ESTABLISHMENTS: Establishment[] = [
  {
    id: 'r1', name: 'Bar do Mestre', organizationId: 'org-mestre', planId: 'plan-business', status: 'active',
    city: 'Campinas', createdAt: '2025-03-12', type: 'Bar', foodCategories: ['Bar', 'Petiscos'],
    address: 'Rua das Flores, 148 · Centro', hours: 'Hoje: 17:00–02:00', rating: 4.7, ratingCount: 312,
    avgTime: '12–18 min', avgWaitMin: 12, distanceM: 350, orderingStatus: 'open', highDemand: false,
    images: [BAR_IMAGES.mestre, BAR_IMAGES.balcao, BAR_IMAGES.drinks], tags: ['Cervejas artesanais', 'Petiscos'],
    mapPosition: { x: 52, y: 35 },
  },
  {
    id: 'r2', name: 'Seu Joaquim Bar', organizationId: 'org-joaquim', planId: 'plan-pro', status: 'active',
    city: 'Campinas', createdAt: '2025-05-02', type: 'Bar', foodCategories: ['Bar', 'Brasileira'],
    address: 'Av. Brasil, 512 · Barão Geraldo', hours: 'Hoje: 18:00–01:00', rating: 4.3, ratingCount: 189,
    avgTime: '25–30 min', avgWaitMin: 25, distanceM: 800, orderingStatus: 'busy', highDemand: true,
    images: [BAR_IMAGES.joaquim, BAR_IMAGES.salao], tags: ['Chopes', 'Botequim'],
    mapPosition: { x: 72, y: 55 },
  },
  {
    id: 'r3', name: 'Cantina Universitária', organizationId: 'org-cantina', planId: 'plan-start', status: 'active',
    city: 'Campinas', createdAt: '2025-02-20', type: 'Cantina', foodCategories: ['Brasileira', 'Lanches'],
    address: 'Campus Unicamp · Cidade Universitária', hours: 'Abre às 18:00', rating: 4.5, ratingCount: 421,
    avgTime: '15–20 min', avgWaitMin: 15, distanceM: 1200, orderingStatus: 'closed', highDemand: false,
    images: [BAR_IMAGES.cantina], tags: ['Almoço', 'Lanches'],
    mapPosition: { x: 28, y: 65 },
  },
  {
    id: 'r4', name: 'Boteco da Vila', organizationId: 'org-vila', planId: 'plan-start', status: 'active',
    city: 'Campinas', createdAt: '2025-07-01', type: 'Bar', foodCategories: ['Bar', 'Petiscos'],
    address: 'Rua da Vila, 88 · Jardim das Flores', hours: 'Hoje: 16:00–00:00', rating: 4.6, ratingCount: 256,
    avgTime: '10–15 min', avgWaitMin: 10, distanceM: 600, orderingStatus: 'open', highDemand: false,
    images: [BAR_IMAGES.vila, BAR_IMAGES.salao], tags: ['Rodízio de petiscos', 'Happy Hour'],
    mapPosition: { x: 60, y: 72 },
  },
  {
    id: 'r5', name: 'Lancheria do Zé', organizationId: 'org-ze', planId: 'plan-pro', status: 'active',
    city: 'Campinas', createdAt: '2025-04-18', type: 'Lanchonete', foodCategories: ['Hambúrguer', 'Lanches'],
    address: 'Rua 7 de Setembro, 203', hours: 'Hoje: 11:00–23:00', rating: 4.4, ratingCount: 178,
    avgTime: '8–12 min', avgWaitMin: 8, distanceM: 450, orderingStatus: 'open', highDemand: false,
    images: [BAR_IMAGES.lanche], tags: ['Hambúrgueres', 'Combos'],
    mapPosition: { x: 40, y: 45 },
  },
  {
    id: 'r6', name: 'Bar do Zé', organizationId: 'org-ze', planId: 'plan-pro', status: 'active',
    city: 'Campinas', createdAt: '2025-04-18', type: 'Bar', foodCategories: ['Bar', 'Petiscos'],
    address: 'Rua Augusta, 742 · Centro', hours: 'Hoje: 17:00–02:00', rating: 4.8, ratingCount: 512,
    avgTime: '15–20 min', avgWaitMin: 15, distanceM: 220, orderingStatus: 'paused', highDemand: false,
    images: [BAR_IMAGES.ze, BAR_IMAGES.balcao], tags: ['Cervejas', 'Petiscos', 'Happy Hour'],
    mapPosition: { x: 46, y: 58 },
  },
  {
    id: 'r7', name: 'Bar do Mestre 2', organizationId: 'org-mestre', planId: 'plan-business', status: 'active',
    city: 'Campinas', createdAt: '2026-06-10', type: 'Bar', foodCategories: ['Bar', 'Hambúrguer'],
    address: 'Av. Norte-Sul, 1200 · Bairro Novo', hours: 'Hoje: 17:00–01:00', rating: 4.5, ratingCount: 64,
    avgTime: '15–20 min', avgWaitMin: 18, distanceM: 2400, orderingStatus: 'open', highDemand: false,
    images: [BAR_IMAGES.salao, BAR_IMAGES.drinks], tags: ['Hambúrgueres', 'Chopes'],
    mapPosition: { x: 80, y: 25 },
  },
  {
    id: 'r8', name: 'Bar do Mestre Express', organizationId: 'org-mestre', planId: 'plan-business', status: 'inactive',
    city: 'Campinas', createdAt: '2026-08-30', type: 'Bar', foodCategories: ['Bar'],
    address: 'Shopping Parque · Piso L2', hours: 'Hoje: 12:00–22:00', rating: 0, ratingCount: 0,
    avgTime: '10–15 min', avgWaitMin: 10, distanceM: 3100, orderingStatus: 'closed', highDemand: false,
    images: [BAR_IMAGES.balcao], tags: ['Express'],
    mapPosition: { x: 15, y: 20 },
  },
  {
    id: 'r9', name: 'Sushi Kazu', organizationId: 'org-kazu', planId: 'plan-pro', status: 'active',
    city: 'Campinas', createdAt: '2025-11-05', type: 'Restaurante', foodCategories: ['Japonesa'],
    address: 'Rua Coronel Quirino, 980 · Cambuí', hours: 'Hoje: 18:00–23:30', rating: 4.6, ratingCount: 230,
    avgTime: '20–25 min', avgWaitMin: 20, distanceM: 1500, orderingStatus: 'open', highDemand: false,
    images: [BAR_IMAGES.sushi, BAR_IMAGES.salao], tags: ['Sushi', 'Temaki'],
    mapPosition: { x: 22, y: 30 },
  },
  {
    id: 'r10', name: 'Restaurante São Paulo', organizationId: 'org-belavista', planId: 'plan-pro', status: 'suspended',
    city: 'São Paulo', createdAt: '2025-01-15', type: 'Restaurante', foodCategories: ['Brasileira'],
    address: 'Av. Paulista, 1500 · Bela Vista', hours: 'Hoje: 11:00–23:00', rating: 4.1, ratingCount: 98,
    avgTime: '20–30 min', avgWaitMin: 25, distanceM: 92000, orderingStatus: 'closed', highDemand: false,
    images: [BAR_IMAGES.salao], tags: ['Executivo'],
    mapPosition: { x: 85, y: 85 },
  },
];

/** Imagem padrão para estabelecimentos recém-cadastrados pelo admin. */
export const DEFAULT_ESTABLISHMENT_IMAGE = BAR_IMAGES.salao;
