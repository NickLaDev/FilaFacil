import type { AvailabilityLogEntry, Ingredient, MenuItem, Promotion, Recipe } from '@/types/catalog';

const img = (id: string) => `https://images.unsplash.com/photo-${id}?w=400&h=300&fit=crop&auto=format`;

/** Ordem de exibição das categorias conhecidas; categorias novas entram no fim. */
export const CATEGORY_ORDER = ['Cervejas', 'Drinks', 'Porções', 'Lanches', 'Combos'];

export const MENU_ITEMS: MenuItem[] = [
  { id: 'm1', establishmentId: 'r1', name: 'Cerveja IPA 600ml', description: 'Artesanal com notas cítricas e amargor equilibrado', price: 18.9, category: 'Cervejas', image: img('1608270586620-248524c67de9'), available: true, orderCount30d: 84, featured: false },
  { id: 'm2', establishmentId: 'r1', name: 'X-Burger', description: 'Hambúrguer artesanal 180g, alface, tomate, cheddar e maionese especial', price: 28.9, category: 'Lanches', image: img('1568901346375-23c9450c58cd'), available: true, orderCount30d: 63, featured: false },
  { id: 'm3', establishmentId: 'r1', name: 'Caipirinha de Limão', description: 'Cachaça premium, limão siciliano e açúcar cristal', price: 22, category: 'Drinks', image: img('1551538827-9c037cb4f32a'), available: true, orderCount30d: 51, featured: false },
  { id: 'm4', establishmentId: 'r1', name: 'Batata Frita', description: 'Porção 400g crocante com molho aïoli', price: 22, category: 'Porções', image: img('1573080496219-bb080dd4f877'), available: true, orderCount30d: 47, featured: false },
  { id: 'm5', establishmentId: 'r1', name: 'X-Bacon', description: 'Hambúrguer com bacon crocante, queijo e cebola caramelizada', price: 32.9, category: 'Lanches', image: img('1553979459-d2229ba7433b'), available: false, orderCount30d: 25, featured: false },
  { id: 'm6', establishmentId: 'r1', name: 'Heineken Long Neck', description: 'Cerveja holandesa 330ml gelada', price: 12.9, category: 'Cervejas', image: img('1535958636474-b021ee887b13'), available: true, orderCount30d: 30, featured: false },
  { id: 'm7', establishmentId: 'r1', name: 'Combo IPA + X-Burger', description: 'Cerveja IPA 600ml + X-Burger com batata pequena', price: 42, category: 'Combos', image: img('1594212699903-ec8a3eca50f5'), available: true, orderCount30d: 39, featured: true },
  { id: 'm8', establishmentId: 'r1', name: 'Gin Tônica', description: 'Gin premium, água tônica, pepino e pimenta rosa', price: 28, category: 'Drinks', image: img('1514362545857-3bc16c4c7d1b'), available: true, orderCount30d: 22, featured: false },
  { id: 'm9', establishmentId: 'r1', name: 'Porção de Coxinha', description: 'Bandeja com 12 unidades, frango desfiado e catupiry', price: 35, category: 'Porções', image: img('1604909052743-94e838986d24'), available: true, orderCount30d: 18, featured: false },
  { id: 'b1', establishmentId: 'r4', name: 'Chopp Pilsen 300ml', description: 'Chopp claro, leve e bem gelado', price: 9.9, category: 'Cervejas', image: img('1608270586620-248524c67de9'), available: true, orderCount30d: 120, featured: false },
  { id: 'b2', establishmentId: 'r4', name: 'Porção de Coxinha', description: 'Bandeja com 10 unidades de frango com catupiry', price: 29, category: 'Porções', image: img('1604909052743-94e838986d24'), available: true, orderCount30d: 64, featured: false },
  { id: 'b3', establishmentId: 'r4', name: 'Batata com Cheddar', description: 'Batata frita com cheddar cremoso e bacon', price: 27, category: 'Porções', image: img('1573080496219-bb080dd4f877'), available: true, orderCount30d: 41, featured: false },
  { id: 'l1', establishmentId: 'r5', name: 'X-Salada', description: 'Hambúrguer 150g, queijo, alface e tomate', price: 24.9, category: 'Lanches', image: img('1568901346375-23c9450c58cd'), available: true, orderCount30d: 98, featured: false },
  { id: 'l2', establishmentId: 'r5', name: 'X-Bacon Duplo', description: 'Dois hambúrgueres, bacon crocante e cheddar', price: 34.9, category: 'Lanches', image: img('1553979459-d2229ba7433b'), available: true, orderCount30d: 77, featured: false },
  { id: 'l3', establishmentId: 'r5', name: 'Combo Lanche + Refri', description: 'X-Salada, batata pequena e refrigerante lata', price: 36, category: 'Combos', image: img('1594212699903-ec8a3eca50f5'), available: true, orderCount30d: 52, featured: false },
];

const DAY = 24 * 60 * 60 * 1000;
const seedNow = Date.now();
const iso = (offsetMs: number) => new Date(seedNow + offsetMs).toISOString();

export const PROMOTIONS: Promotion[] = [
  { id: 'p1', establishmentId: 'r1', name: 'Happy Hour', itemIds: ['m3', 'm8'], discountPercent: 20, startsAt: iso(-DAY), endsAt: iso(7 * DAY) },
  { id: 'p2', establishmentId: 'r1', name: 'Combo da semana', itemIds: ['m7'], discountPercent: 15, startsAt: iso(-2 * DAY), endsAt: iso(5 * DAY) },
  { id: 'p3', establishmentId: 'r1', name: 'Quarta universitária', itemIds: ['m1', 'm6'], discountPercent: 10, startsAt: iso(-10 * DAY), endsAt: iso(-3 * DAY) },
];

export const AVAILABILITY_LOG: AvailabilityLogEntry[] = [
  { id: 'log-1', establishmentId: 'r1', itemId: 'm5', itemName: 'X-Bacon', available: false, actor: 'Carlos Mendes', at: iso(-40 * 60 * 1000) },
];

export const INGREDIENTS: Ingredient[] = [
  { id: 'i1', establishmentId: 'r1', name: 'Pão de hambúrguer', unit: 'un', unitCost: 1.2 },
  { id: 'i2', establishmentId: 'r1', name: 'Hambúrguer 180g', unit: 'un', unitCost: 7.2 },
  { id: 'i3', establishmentId: 'r1', name: 'Queijo cheddar (fatia)', unit: 'un', unitCost: 0.9 },
  { id: 'i4', establishmentId: 'r1', name: 'Molho especial', unit: 'g', unitCost: 0.06 },
  { id: 'i5', establishmentId: 'r1', name: 'Batata congelada', unit: 'kg', unitCost: 9.33 },
  { id: 'i6', establishmentId: 'r1', name: 'Óleo de fritura', unit: 'L', unitCost: 24 },
  { id: 'i7', establishmentId: 'r1', name: 'Cerveja IPA 600ml', unit: 'un', unitCost: 6.4 },
  { id: 'i8', establishmentId: 'r1', name: 'Gin', unit: 'ml', unitCost: 0.12 },
  { id: 'i9', establishmentId: 'r1', name: 'Água tônica', unit: 'ml', unitCost: 0.0134 },
  { id: 'i10', establishmentId: 'r1', name: 'Limão', unit: 'un', unitCost: 1.6 },
  { id: 'i11', establishmentId: 'r1', name: 'Cachaça premium', unit: 'ml', unitCost: 0.06 },
  { id: 'i12', establishmentId: 'r1', name: 'Açúcar cristal', unit: 'g', unitCost: 0.01 },
];

export const RECIPES: Recipe[] = [
  { id: 'rc1', menuItemId: 'm2', costLimitPercent: 35, lines: [{ ingredientId: 'i1', quantity: 1 }, { ingredientId: 'i2', quantity: 1 }, { ingredientId: 'i3', quantity: 2 }, { ingredientId: 'i4', quantity: 20 }] },
  { id: 'rc2', menuItemId: 'm4', costLimitPercent: 30, lines: [{ ingredientId: 'i5', quantity: 0.4 }, { ingredientId: 'i6', quantity: 0.05 }] },
  { id: 'rc3', menuItemId: 'm1', costLimitPercent: 35, lines: [{ ingredientId: 'i7', quantity: 1 }] },
  { id: 'rc4', menuItemId: 'm8', costLimitPercent: 35, lines: [{ ingredientId: 'i8', quantity: 50 }, { ingredientId: 'i9', quantity: 150 }, { ingredientId: 'i10', quantity: 0.5 }] },
  { id: 'rc5', menuItemId: 'm3', costLimitPercent: 30, lines: [{ ingredientId: 'i11', quantity: 60 }, { ingredientId: 'i10', quantity: 1 }, { ingredientId: 'i12', quantity: 20 }] },
];
