export type EstablishmentStatus = 'active' | 'inactive' | 'suspended';

/** Situação operacional vista pelo cliente (diferente do status cadastral do admin). */
export type OrderingStatus = 'open' | 'busy' | 'paused' | 'closed';

export type EstablishmentType = 'Bar' | 'Restaurante' | 'Cantina' | 'Lanchonete';

export interface Organization {
  id: string;
  name: string;
}

export interface Establishment {
  id: string;
  name: string;
  organizationId: string;
  planId: string;
  status: EstablishmentStatus;
  city: string;
  createdAt: string;
  type: EstablishmentType;
  foodCategories: string[];
  address: string;
  hours: string;
  rating: number;
  ratingCount: number;
  avgTime: string;
  avgWaitMin: number;
  distanceM: number;
  orderingStatus: OrderingStatus;
  highDemand: boolean;
  images: string[];
  tags: string[];
  /** Posição relativa (0–100) no mapa simulado da busca. */
  mapPosition: { x: number; y: number };
}

export type PlanFeature = 'floor-plan' | 'waitlist' | 'promotions' | 'recipes' | 'layout-duplication';

export interface Plan {
  id: string;
  name: string;
  monthlyPrice: number;
  limits: { units: number; tables: number; staff: number };
  features: PlanFeature[];
}
