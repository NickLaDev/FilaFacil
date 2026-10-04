import { Prisma } from '../../generated/prisma/client.js';
import { calculateSheetCost } from './sheet-cost.js';

const d = (value: string) => new Prisma.Decimal(value);

describe('custo da ficha técnica', () => {
  it('soma quantidade × custo unitário em Decimal, sem erro de ponto flutuante', () => {
    const cost = calculateSheetCost(
      [
        { quantity: d('50'), unitCost: d('0.12') },
        { quantity: d('150'), unitCost: d('0.0134') },
        { quantity: d('0.5'), unitCost: d('1.60') },
      ],
      2800,
      d('35'),
    );
    expect(cost.totalCost.toFixed(4)).toBe('8.8100');
    expect(cost.costPercent).toBe(31.5);
    expect(cost.overLimit).toBe(false);
  });

  it('alerta quando o custo passa do limite definido', () => {
    const cost = calculateSheetCost([{ quantity: d('1'), unitCost: d('11.40') }], 2890, d('35'));
    expect(cost.costPercent).toBe(39.4);
    expect(cost.overLimit).toBe(true);
  });
});
