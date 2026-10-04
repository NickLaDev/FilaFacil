/** Preço com desconto em centavos inteiros (sem ponto flutuante acumulando erro). */
export const applyDiscount = (priceCents: number, discountPercent: number) =>
  Math.round((priceCents * (100 - discountPercent)) / 100);

export type PromotionWindowState = 'scheduled' | 'active' | 'expired';

/** Vigência pelo período: ativa e encerra sozinha, sem job agendado (ficha 29). */
export function promotionState(startsAt: Date, endsAt: Date, now: Date): PromotionWindowState {
  if (now < startsAt) return 'scheduled';
  if (now > endsAt) return 'expired';
  return 'active';
}

/** Entre promoções ativas do mesmo item, vale a de maior desconto. */
export function bestPromotion<T extends { discountPercent: number }>(promotions: T[]): T | null {
  return promotions.reduce<T | null>((best, promotion) => (!best || promotion.discountPercent > best.discountPercent ? promotion : best), null);
}
