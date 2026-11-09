import { Injectable } from '@nestjs/common';
import type { CostReportDto } from '@filafacil/shared';
import { unprocessable } from '../../common/http/app-error.js';
import { zonedInstant } from '../../common/time/day-bounds.js';
import { PrismaService } from '../../database/prisma.service.js';
import { buildCostReport, type SoldItem } from './cost-report.js';

const MAX_RANGE_DAYS = 366;
/** Pedidos que contam como vendidos: pagos (ou quitados na comanda) e não cancelados/estornados. */
const SOLD_STATUSES = ['paid', 'preparing', 'ready', 'delivered'] as const;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Período em dias civis do fuso do estabelecimento, `from` e `to` inclusivos (pela data do pagamento). */
  async costReport(establishmentId: string, from: string, to: string): Promise<CostReportDto> {
    const establishment = await this.prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { timezone: true } });
    const start = zonedInstant(from, 0, establishment.timezone);
    const endDay = zonedInstant(to, 0, establishment.timezone);
    if (!start || !endDay) throw unprocessable('INVALID_PERIOD', 'Informe as datas no formato AAAA-MM-DD.');
    const end = new Date(endDay.getTime() + 86_400_000);
    if (end <= start) throw unprocessable('INVALID_PERIOD', 'A data final deve ser igual ou posterior à inicial.');
    if ((end.getTime() - start.getTime()) / 86_400_000 > MAX_RANGE_DAYS) throw unprocessable('PERIOD_TOO_LONG', `O período pode ter no máximo ${MAX_RANGE_DAYS} dias.`);

    const grouped = await this.prisma.orderItem.groupBy({
      by: ['menuItemId'],
      where: { order: { establishmentId, status: { in: [...SOLD_STATUSES] }, paidAt: { gte: start, lt: end } } },
      _sum: { quantity: true },
    });
    const ids = grouped.map(group => group.menuItemId);
    // Receita = preço cobrado de cada item (promoção do item incluída), somada linha a linha.
    const lines = ids.length
      ? await this.prisma.orderItem.findMany({
          where: { menuItemId: { in: ids }, order: { establishmentId, status: { in: [...SOLD_STATUSES] }, paidAt: { gte: start, lt: end } } },
          select: { menuItemId: true, unitPriceCents: true, quantity: true },
        })
      : [];
    const revenue = new Map<string, number>();
    for (const line of lines) revenue.set(line.menuItemId, (revenue.get(line.menuItemId) ?? 0) + line.unitPriceCents * line.quantity);

    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: ids }, establishmentId },
      select: {
        id: true,
        name: true,
        priceCents: true,
        category: { select: { name: true } },
        technicalSheet: { select: { costLimitPercent: true, items: { select: { quantity: true, ingredient: { select: { unitCost: true } } } } } },
      },
    });
    const byId = new Map(menuItems.map(item => [item.id, item]));
    const sold: SoldItem[] = grouped.flatMap(group => {
      const item = byId.get(group.menuItemId);
      if (!item) return [];
      return [
        {
          menuItemId: item.id,
          name: item.name,
          category: item.category.name,
          quantity: group._sum.quantity ?? 0,
          revenueCents: revenue.get(item.id) ?? 0,
          sheet: item.technicalSheet && { lines: item.technicalSheet.items.map(line => ({ quantity: line.quantity, unitCost: line.ingredient.unitCost })), priceCents: item.priceCents, costLimitPercent: item.technicalSheet.costLimitPercent },
        },
      ];
    });
    return buildCostReport(from, to, sold);
  }
}
