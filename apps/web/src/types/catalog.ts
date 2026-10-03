export interface MenuItem {
  id: string;
  establishmentId: string;
  name: string;
  description: string;
  price: number;
  category: string;
  image: string;
  available: boolean;
  /** Volume vendido nos últimos 30 dias — base do selo "+ pedido" (calculado pelo backend). */
  orderCount30d: number;
  /** Destaque manual do gestor; também exibe o selo "+ pedido". */
  featured: boolean;
}

export interface Promotion {
  id: string;
  establishmentId: string;
  name: string;
  itemIds: string[];
  discountPercent: number;
  startsAt: string;
  endsAt: string;
}

export type PromotionState = 'scheduled' | 'active' | 'expired';

export interface AvailabilityLogEntry {
  id: string;
  establishmentId: string;
  itemId: string;
  itemName: string;
  available: boolean;
  actor: string;
  at: string;
}

export type IngredientUnit = 'un' | 'kg' | 'g' | 'L' | 'ml';

export interface Ingredient {
  id: string;
  establishmentId: string;
  name: string;
  unit: IngredientUnit;
  unitCost: number;
}

export interface RecipeLine {
  ingredientId: string;
  quantity: number;
}

export interface Recipe {
  id: string;
  menuItemId: string;
  lines: RecipeLine[];
  /** Custo máximo aceito, em % do preço de venda. */
  costLimitPercent: number;
}
