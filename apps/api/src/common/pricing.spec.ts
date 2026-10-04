import { applyDiscount, bestPromotion, promotionState } from './pricing.js';

describe('preço promocional', () => {
  it('calcula o desconto em centavos inteiros', () => {
    expect(applyDiscount(2200, 20)).toBe(1760);
    expect(applyDiscount(1999, 15)).toBe(1699);
  });

  it('deriva a vigência do período sem job agendado', () => {
    const start = new Date('2026-10-01T00:00:00Z');
    const end = new Date('2026-10-08T00:00:00Z');
    expect(promotionState(start, end, new Date('2026-09-30T23:59:59Z'))).toBe('scheduled');
    expect(promotionState(start, end, new Date('2026-10-05T12:00:00Z'))).toBe('active');
    expect(promotionState(start, end, new Date('2026-10-08T00:00:01Z'))).toBe('expired');
  });

  it('usa a promoção de maior desconto quando o item está em várias', () => {
    expect(bestPromotion([{ discountPercent: 10 }, { discountPercent: 25 }, { discountPercent: 15 }])).toEqual({ discountPercent: 25 });
    expect(bestPromotion([])).toBeNull();
  });
});
