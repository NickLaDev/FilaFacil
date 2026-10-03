/** Custos de insumo costumam ter frações de centavo (ex.: R$ 0,0134/ml). */
export const formatUnitCost = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });

export const formatQuantity = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export const formatPercent = (value: number) => `${Math.round(value)}%`;
