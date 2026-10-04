import { Prisma } from '../../generated/prisma/client.js';

type Decimal = Prisma.Decimal;

export interface CostLine {
  quantity: Decimal;
  unitCost: Decimal;
}

/**
 * Custo do prato pela ficha técnica (ficha 31), em Decimal: soma de quantidade × custo unitário
 * de cada insumo, percentual sobre o preço de venda e alerta acima do limite definido.
 */
export function calculateSheetCost(lines: CostLine[], priceCents: number, costLimitPercent: Decimal) {
  const lineCosts = lines.map(line => line.quantity.times(line.unitCost));
  const total = lineCosts.reduce((sum, cost) => sum.plus(cost), new Prisma.Decimal(0));
  const price = new Prisma.Decimal(priceCents).dividedBy(100);
  const percent = price.greaterThan(0) ? total.dividedBy(price).times(100) : new Prisma.Decimal(0);
  return {
    lineCosts: lineCosts.map(cost => cost.toDecimalPlaces(4)),
    totalCost: total.toDecimalPlaces(4),
    costPercent: percent.toDecimalPlaces(1).toNumber(),
    overLimit: percent.greaterThan(costLimitPercent),
  };
}
