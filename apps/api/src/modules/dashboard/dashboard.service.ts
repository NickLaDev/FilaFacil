import { Injectable } from '@nestjs/common';
import type { DashboardDto } from '@filafacil/shared';
import { dayBounds } from '../../common/time/day-bounds.js';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * Dashboard de gestão (ficha 27): só dados reais do banco, no dia civil do estabelecimento. Faturamento e pedidos
 * contam pedidos efetivamente pagos no dia (gateway aprovado ou comanda quitada) e não cancelados/estornados.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async get(establishmentId: string, now = new Date()): Promise<DashboardDto> {
    const establishment = await this.prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { timezone: true, averageWaitMinutes: true } });
    const { start, end } = dayBounds(now, establishment.timezone);
    const [paid, occupiedTables, totalTables, waitlistCount, active] = await Promise.all([
      this.prisma.order.aggregate({ where: { establishmentId, paidAt: { gte: start, lt: end }, status: { not: 'cancelled' } }, _count: { _all: true }, _sum: { totalCents: true } }),
      this.prisma.diningTable.count({ where: { establishmentId, occupancy: 'occupied' } }),
      this.prisma.diningTable.count({ where: { establishmentId } }),
      this.prisma.waitlistEntry.count({ where: { establishmentId, status: { in: ['waiting', 'notified'] } } }),
      this.prisma.order.findMany({
        where: { establishmentId, OR: [{ status: { in: ['paid', 'preparing'] } }, { status: 'received', tabId: { not: null } }] },
        select: { paidAt: true, createdAt: true, estimatedMinutesOverride: true },
      }),
    ]);
    const ordersCount = paid._count._all;
    const revenueCents = paid._sum.totalCents ?? 0;
    const lateOrders = active.filter(order => {
      const age = Math.floor((now.getTime() - (order.paidAt ?? order.createdAt).getTime()) / 60_000);
      return age > (order.estimatedMinutesOverride ?? establishment.averageWaitMinutes);
    }).length;
    return {
      dayStart: start.toISOString(),
      dayEnd: end.toISOString(),
      ordersCount,
      revenueCents,
      averageTicketCents: ordersCount > 0 ? Math.floor(revenueCents / ordersCount) : 0,
      occupiedTables,
      totalTables,
      waitlistCount,
      lateOrders,
      generatedAt: now.toISOString(),
    };
  }
}
