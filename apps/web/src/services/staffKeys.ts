/** Chaves de cache dos painéis, sempre sob o estabelecimento autorizado. */
export const staffKeys = {
  root: (establishmentId: string) => ['staff', establishmentId] as const,
  plan: (establishmentId: string) => ['staff', establishmentId, 'plan'] as const,
  menu: (establishmentId: string) => ['staff', establishmentId, 'menu'] as const,
  categories: (establishmentId: string) => ['staff', establishmentId, 'categories'] as const,
  availabilityHistory: (establishmentId: string) => ['staff', establishmentId, 'availability-history'] as const,
  promotions: (establishmentId: string) => ['staff', establishmentId, 'promotions'] as const,
  ingredients: (establishmentId: string) => ['staff', establishmentId, 'ingredients'] as const,
  sheets: (establishmentId: string) => ['staff', establishmentId, 'technical-sheets'] as const,
  floor: (establishmentId: string) => ['staff', establishmentId, 'floor-plan'] as const,
  tableMap: (establishmentId: string) => ['staff', establishmentId, 'table-map'] as const,
  ranking: (establishmentId: string) => ['staff', establishmentId, 'menu-ranking'] as const,
  waitlist: (establishmentId: string) => ['staff', establishmentId, 'waitlist'] as const,
  orders: (establishmentId: string) => ['staff', establishmentId, 'orders'] as const,
};
