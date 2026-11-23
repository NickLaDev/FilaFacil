import { Injectable } from '@nestjs/common';
import { PLATFORM_TIMEZONE, percentChange, type DayMetrics, type MetricsPeriod, type PlatformMetricsDto, type PlatformOverviewDto } from '@filafacil/shared';
import { unprocessable } from '../../common/http/app-error.js';
import { localDate, zonedInstant } from '../../common/time/day-bounds.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { RestaurantsService } from '../restaurants/restaurants.service.js';

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;
/** Pedido que conta como venda: pago (ou quitado na comanda) e não cancelado/estornado. Data = pagamento. */
const SOLD = Prisma.sql`o.status IN ('paid', 'preparing', 'ready', 'delivered') AND o.paid_at IS NOT NULL`;

interface DayRow {
  day: string;
  establishment_id: string;
  orders: number;
  gmv: bigint | number | null;
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

/** Início (inclusive) e fim (exclusivo) dos dias civis de Brasília `from`..`to`. */
function bounds(from: string, to: string) {
  const start = zonedInstant(from, 0, PLATFORM_TIMEZONE);
  const endDay = zonedInstant(to, 0, PLATFORM_TIMEZONE);
  if (!start || !endDay) throw unprocessable('INVALID_PERIOD', 'Informe as datas no formato AAAA-MM-DD.');
  const end = new Date(endDay.getTime() + DAY_MS);
  if (end <= start) throw unprocessable('INVALID_PERIOD', 'A data final deve ser igual ou posterior à inicial.');
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw unprocessable('PERIOD_TOO_LONG', `O período pode ter no máximo ${MAX_RANGE_DAYS} dias.`);
  return { start, end };
}

/**
 * Números da plataforma (fichas 32 e 41). Uma única regra para tudo: pedidos pagos e não cancelados, pela data do
 * pagamento no dia civil de Brasília; GMV = soma do total pago; usuário ativo = quem entrou ou fez pedido no dia.
 * Os totais são sempre a soma das linhas por estabelecimento (as telas batem com a soma por casa).
 */
@Injectable()
export class PlatformMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restaurants: RestaurantsService,
  ) {}

  private async salesByDay(start: Date, end: Date): Promise<DayRow[]> {
    return this.prisma.$queryRaw<DayRow[]>`
      SELECT to_char((o.paid_at AT TIME ZONE ${PLATFORM_TIMEZONE})::date, 'YYYY-MM-DD') AS day, o.establishment_id::text AS establishment_id,
             COUNT(*)::int AS orders, SUM(o.total_cents)::bigint AS gmv
      FROM orders o
      WHERE ${SOLD} AND o.paid_at >= ${start} AND o.paid_at < ${end}
      GROUP BY 1, 2`;
  }

  private async activeUsersByDay(start: Date, end: Date): Promise<{ days: Map<string, number>; distinct: number }> {
    const rows = await this.prisma.$queryRaw<{ day: string; user_id: string }[]>`
      SELECT DISTINCT to_char((created_at AT TIME ZONE ${PLATFORM_TIMEZONE})::date, 'YYYY-MM-DD') AS day, user_id::text AS user_id FROM (
        SELECT created_at, user_id FROM access_logs WHERE created_at >= ${start} AND created_at < ${end}
        UNION ALL
        SELECT created_at, user_id FROM orders WHERE created_at >= ${start} AND created_at < ${end}
      ) activity`;
    const days = new Map<string, number>();
    for (const row of rows) days.set(row.day, (days.get(row.day) ?? 0) + 1);
    return { days, distinct: new Set(rows.map(row => row.user_id)).size };
  }

  private async period(from: string, to: string): Promise<MetricsPeriod & { rows: DayRow[] }> {
    const { start, end } = bounds(from, to);
    const [rows, users] = await Promise.all([this.salesByDay(start, end), this.activeUsersByDay(start, end)]);
    const series = Array.from({ length: daysBetween(from, to) }, (_, index) => {
      const date = addDays(from, index);
      const day = rows.filter(row => row.day === date);
      return { date, orders: day.reduce((sum, row) => sum + row.orders, 0), gmvCents: day.reduce((sum, row) => sum + Number(row.gmv ?? 0), 0), activeUsers: users.days.get(date) ?? 0 };
    });
    const totals: DayMetrics = {
      orders: series.reduce((sum, point) => sum + point.orders, 0),
      gmvCents: series.reduce((sum, point) => sum + point.gmvCents, 0),
      activeUsers: users.distinct,
    };
    return { from, to, totals, series, rows };
  }

  /** Ficha 41: período escolhido × período anterior de mesmo tamanho (ou o informado). */
  async metrics(query: { from: string; to: string; compareFrom?: string; compareTo?: string }): Promise<PlatformMetricsDto> {
    const length = daysBetween(query.from, query.to);
    const compareTo = query.compareTo ?? addDays(query.from, -1);
    const compareFrom = query.compareFrom ?? addDays(compareTo, -(length - 1));
    const [current, previous] = await Promise.all([this.period(query.from, query.to), this.period(compareFrom, compareTo)]);
    const byId = new Map<string, { orders: number; gmvCents: number }>();
    for (const row of current.rows) {
      const entry = byId.get(row.establishment_id) ?? { orders: 0, gmvCents: 0 };
      entry.orders += row.orders;
      entry.gmvCents += Number(row.gmv ?? 0);
      byId.set(row.establishment_id, entry);
    }
    const names = await this.prisma.establishment.findMany({ where: { id: { in: [...byId.keys()] } }, select: { id: true, name: true } });
    const byEstablishment = names.map(row => ({ id: row.id, name: row.name, ...(byId.get(row.id) as { orders: number; gmvCents: number }) })).sort((a, b) => b.gmvCents - a.gmvCents || a.name.localeCompare(b.name, 'pt-BR'));
    const strip = (period: MetricsPeriod & { rows: DayRow[] }): MetricsPeriod => ({ from: period.from, to: period.to, series: period.series, totals: period.totals });
    return {
      current: strip(current),
      previous: strip(previous),
      change: {
        orders: percentChange(current.totals.orders, previous.totals.orders),
        gmvCents: percentChange(current.totals.gmvCents, previous.totals.gmvCents),
        activeUsers: percentChange(current.totals.activeUsers, previous.totals.activeUsers),
      },
      byEstablishment,
    };
  }

  /** Ficha 32: hoje × ontem para os estabelecimentos ativos, com o que precisa de atenção. */
  async overview(date?: string, now = new Date()): Promise<PlatformOverviewDto> {
    const today = date ?? localDate(now, PLATFORM_TIMEZONE);
    const yesterday = addDays(today, -1);
    const { start, end } = bounds(yesterday, today);
    const todayRange = bounds(today, today);
    const yesterdayRange = bounds(yesterday, yesterday);
    const [establishments, rows, users, incidents, overdue, suspended, organizations] = await Promise.all([
      this.prisma.establishment.findMany({
        where: { status: 'active' },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          status: true,
          timezone: true,
          ordersPaused: true,
          highDemand: true,
          organization: { select: { id: true, name: true } },
          plan: { select: { name: true } },
          openingHours: { select: { weekday: true, opensAt: true, closesAt: true } },
        },
      }),
      this.salesByDay(start, end),
      this.activeUsersByDay(todayRange.start, todayRange.end),
      this.prisma.incident.findMany({ where: { resolvedAt: null }, select: { establishmentId: true } }),
      this.prisma.invoice.findMany({ where: { status: 'overdue' }, select: { establishmentId: true } }),
      this.prisma.establishment.count({ where: { status: 'suspended' } }),
      this.prisma.organization.count(),
    ]);
    const withIncident = new Set(incidents.map(row => row.establishmentId));
    const withOverdue = new Set(overdue.map(row => row.establishmentId));
    const sum = (id: string, day: string) => {
      const match = rows.filter(row => row.establishment_id === id && row.day === day);
      return { orders: match.reduce((acc, row) => acc + row.orders, 0), gmvCents: match.reduce((acc, row) => acc + Number(row.gmv ?? 0), 0) };
    };
    const lines = establishments.map(row => {
      const todayNumbers = sum(row.id, today);
      const problems: PlatformOverviewDto['establishments'][number]['problems'] = [];
      if (withIncident.has(row.id)) problems.push('incident');
      if (withOverdue.has(row.id)) problems.push('overdue_invoice');
      if (row.ordersPaused) problems.push('orders_paused');
      else if (!date && todayNumbers.orders === 0 && this.restaurants.orderingState(row, now).isOpenNow) problems.push('no_orders_today');
      return {
        id: row.id,
        name: row.name,
        organizationId: row.organization.id,
        organizationName: row.organization.name,
        status: row.status,
        planName: row.plan.name,
        today: todayNumbers,
        yesterday: sum(row.id, yesterday),
        problems,
      };
    });
    // Quem precisa de atenção primeiro; depois, quem mais vende.
    lines.sort((a, b) => b.problems.length - a.problems.length || b.today.gmvCents - a.today.gmvCents || a.name.localeCompare(b.name, 'pt-BR'));
    const totalOf = (key: 'today' | 'yesterday') => ({ orders: lines.reduce((acc, line) => acc + line[key].orders, 0), gmvCents: lines.reduce((acc, line) => acc + line[key].gmvCents, 0) });
    const yesterdayUsers = await this.activeUsersByDay(yesterdayRange.start, yesterdayRange.end);
    const activeToday = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT user_id::text AS id FROM (
        SELECT user_id FROM access_logs WHERE created_at >= ${todayRange.start} AND created_at < ${todayRange.end}
        UNION ALL SELECT user_id FROM orders WHERE created_at >= ${todayRange.start} AND created_at < ${todayRange.end}
      ) activity`;
    const userRows = await this.prisma.user.findMany({
      where: { id: { in: activeToday.map(row => row.id) }, deletedAt: null },
      orderBy: { lastAccessAt: { sort: 'desc', nulls: 'last' } },
      take: 50,
      select: { id: true, name: true, role: true, lastAccessAt: true },
    });
    return {
      date: today,
      activeEstablishments: establishments.length,
      suspendedEstablishments: suspended,
      organizations,
      today: { ...totalOf('today'), activeUsers: users.distinct },
      yesterday: { ...totalOf('yesterday'), activeUsers: yesterdayUsers.distinct },
      establishments: lines,
      activeUsers: userRows.map(row => ({ id: row.id, name: row.name, role: row.role, lastAccessAt: row.lastAccessAt?.toISOString() ?? null })),
      generatedAt: now.toISOString(),
    };
  }
}
