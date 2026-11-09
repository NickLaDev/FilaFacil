import type { CostReportCategory, CostReportDto, CostReportRow } from '@filafacil/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { calculateSheetCost } from '../technical-sheets/sheet-cost.js';

export interface SoldItem {
  menuItemId: string;
  name: string;
  category: string;
  quantity: number;
  revenueCents: number;
  /** Ficha técnica atual do item (null = sem ficha). */
  sheet: { lines: { quantity: Prisma.Decimal; unitCost: Prisma.Decimal }[]; priceCents: number; costLimitPercent: Prisma.Decimal } | null;
}

const percent = (margin: number, revenue: number) => (revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null);

/**
 * Custo do período (ficha 57): custo da ficha técnica × quantidade vendida de cada item, em centavos inteiros.
 * O custo de cada linha é arredondado uma única vez, e os totais são a soma das linhas — o relatório sempre fecha
 * com "custo da ficha × quantidade". Item sem ficha fica sem custo/margem e não entra nos totais de custo e margem.
 */
export function buildCostReport(from: string, to: string, items: SoldItem[]): CostReportDto {
  const rows: CostReportRow[] = items
    .map(item => {
      if (!item.sheet) {
        return { menuItemId: item.menuItemId, name: item.name, category: item.category, quantity: item.quantity, revenueCents: item.revenueCents, costCents: null, marginCents: null, marginPercent: null };
      }
      const { totalCost } = calculateSheetCost(item.sheet.lines, item.sheet.priceCents, item.sheet.costLimitPercent);
      const costCents = totalCost.times(100).times(item.quantity).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
      const marginCents = item.revenueCents - costCents;
      return { menuItemId: item.menuItemId, name: item.name, category: item.category, quantity: item.quantity, revenueCents: item.revenueCents, costCents, marginCents, marginPercent: percent(marginCents, item.revenueCents) };
    })
    .sort((a, b) => a.category.localeCompare(b.category, 'pt-BR') || a.name.localeCompare(b.name, 'pt-BR'));

  const byCategory = new Map<string, CostReportCategory>();
  for (const row of rows) {
    if (row.costCents === null || row.marginCents === null) continue;
    const entry = byCategory.get(row.category) ?? { category: row.category, quantity: 0, revenueCents: 0, costCents: 0, marginCents: 0, marginPercent: null };
    entry.quantity += row.quantity;
    entry.revenueCents += row.revenueCents;
    entry.costCents += row.costCents;
    entry.marginCents += row.marginCents;
    byCategory.set(row.category, entry);
  }
  const categories = [...byCategory.values()].map(entry => ({ ...entry, marginPercent: percent(entry.marginCents, entry.revenueCents) })).sort((a, b) => a.category.localeCompare(b.category, 'pt-BR'));

  const covered = rows.filter(row => row.costCents !== null);
  const coveredRevenueCents = covered.reduce((sum, row) => sum + row.revenueCents, 0);
  const costCents = covered.reduce((sum, row) => sum + (row.costCents ?? 0), 0);
  const marginCents = coveredRevenueCents - costCents;
  return {
    from,
    to,
    rows,
    categories,
    totals: {
      quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
      revenueCents: rows.reduce((sum, row) => sum + row.revenueCents, 0),
      coveredRevenueCents,
      costCents,
      marginCents,
      marginPercent: percent(marginCents, coveredRevenueCents),
    },
    itemsWithoutSheet: rows.length - covered.length,
  };
}

const brl = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const csvCell = (value: string | number | null) => {
  const text = value === null ? '' : String(value);
  // Neutraliza injeção de fórmula em planilhas (=, +, -, @) em textos vindos do cardápio.
  const safe = /^[=+\-@]/.test(text) && typeof value === 'string' ? `'${text}` : text;
  return /[;"\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** CSV para Excel pt-BR: separador `;`, vírgula decimal e BOM UTF-8. */
export function costReportCsv(report: CostReportDto): string {
  const lines = [
    ['Item', 'Categoria', 'Quantidade', 'Receita (R$)', 'Custo (R$)', 'Margem (R$)', 'Margem (%)'],
    ...report.rows.map(row => [row.name, row.category, row.quantity, brl(row.revenueCents), row.costCents === null ? 'sem ficha técnica' : brl(row.costCents), row.marginCents === null ? '' : brl(row.marginCents), row.marginPercent === null ? '' : String(row.marginPercent).replace('.', ',')]),
    [],
    ['Categoria', '', 'Quantidade', 'Receita (R$)', 'Custo (R$)', 'Margem (R$)', 'Margem (%)'],
    ...report.categories.map(c => [c.category, '', c.quantity, brl(c.revenueCents), brl(c.costCents), brl(c.marginCents), c.marginPercent === null ? '' : String(c.marginPercent).replace('.', ',')]),
    [],
    ['Total (itens com ficha)', '', report.totals.quantity, brl(report.totals.coveredRevenueCents), brl(report.totals.costCents), brl(report.totals.marginCents), report.totals.marginPercent === null ? '' : String(report.totals.marginPercent).replace('.', ',')],
  ];
  return `﻿${lines.map(line => line.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
