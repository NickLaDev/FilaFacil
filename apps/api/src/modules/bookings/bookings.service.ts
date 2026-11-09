import { Injectable } from '@nestjs/common';
import {
  BOOKING_DURATION_MINUTES,
  BOOKING_MAX_DAYS_AHEAD,
  BOOKING_MAX_PARTY,
  BOOKING_MIN_LEAD_MINUTES,
  BOOKING_SLOT_STEP_MINUTES,
  type BookingDto,
  type BookingSlotsDto,
  type BookingStatus,
  type CreateBookingRequest,
} from '@filafacil/shared';
import { conflict, notFound, unprocessable } from '../../common/http/app-error.js';
import { localDate, zonedInstant } from '../../common/time/day-bounds.js';
import { activeRange, formatMinutes, localClock, type OpeningRange } from '../../common/time/opening-hours.js';
import { lockResource } from '../../database/advisory-lock.js';
import { PrismaService } from '../../database/prisma.service.js';
import { InboxService } from '../inbox/inbox.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const DURATION_MS = BOOKING_DURATION_MINUTES * 60_000;
/** Reserva da equipe (ficha 16) não tem duração: bloqueia a mesa por este tempo a partir do horário marcado. */
const STAFF_RESERVATION_MS = DURATION_MS;
const BLOCKING: BookingStatus[] = ['confirmed', 'seated'];

interface TableLite {
  id: string;
  label: string;
  capacity: number;
}
interface Occupation {
  tableId: string;
  from: number;
  to: number;
}

const BOOKING_INCLUDE = {
  establishment: { select: { name: true, timezone: true } },
  table: { select: { label: true } },
  user: { select: { name: true, phone: true } },
} as const;

type BookingRow = {
  id: string;
  establishmentId: string;
  partySize: number;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  refusalReason: string | null;
  createdAt: Date;
  establishment: { name: string; timezone: string };
  table: { label: string } | null;
  user: { name: string; phone: string | null };
};

const toDto = (row: BookingRow, includeCustomer = false): BookingDto => ({
  id: row.id,
  establishmentId: row.establishmentId,
  establishmentName: row.establishment.name,
  timezone: row.establishment.timezone,
  tableLabel: row.table?.label ?? null,
  partySize: row.partySize,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  status: row.status,
  refusalReason: row.refusalReason,
  ...(includeCustomer && { customerName: row.user.name, customerPhone: row.user.phone }),
  createdAt: row.createdAt.toISOString(),
});

/** Primeira mesa (a menor que comporta o grupo) sem ocupação que se sobreponha ao intervalo. */
export function pickTable(tables: TableLite[], party: number, occupations: Occupation[], from: number, to: number): TableLite | null {
  return (
    tables
      .filter(table => table.capacity >= party)
      .sort((a, b) => a.capacity - b.capacity || a.label.localeCompare(b.label, 'pt-BR', { numeric: true }))
      .find(table => !occupations.some(o => o.tableId === table.id && o.from < to && o.to > from)) ?? null
  );
}

/**
 * Reservas de mesa do cliente (ficha 30). A resposta é imediata: confirmada se há mesa livre no horário (menor mesa
 * que comporta o grupo, por 90 min) ou recusada com o motivo. A decisão roda sob lock do estabelecimento, então duas
 * reservas simultâneas nunca ocupam a mesma mesa no mesmo horário.
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly inbox: InboxService,
  ) {}

  // ─── Cliente ──────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateBookingRequest, now = new Date()): Promise<BookingDto> {
    const startsAt = new Date(dto.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw unprocessable('INVALID_BOOKING_TIME', 'Horário inválido.');
    if (!Number.isInteger(dto.partySize) || dto.partySize < 1 || dto.partySize > BOOKING_MAX_PARTY) {
      throw unprocessable('INVALID_PARTY_SIZE', `A reserva é para 1 a ${BOOKING_MAX_PARTY} pessoas.`);
    }
    if (startsAt.getTime() < now.getTime() + BOOKING_MIN_LEAD_MINUTES * 60_000) {
      throw unprocessable('BOOKING_TOO_SOON', `Reserve com pelo menos ${BOOKING_MIN_LEAD_MINUTES} minutos de antecedência.`);
    }
    if (startsAt.getTime() > now.getTime() + BOOKING_MAX_DAYS_AHEAD * 86_400_000) {
      throw unprocessable('BOOKING_TOO_FAR', `Só é possível reservar para os próximos ${BOOKING_MAX_DAYS_AHEAD} dias.`);
    }
    const establishment = await this.prisma.establishment.findFirst({
      where: { id: dto.establishmentId, status: 'active' },
      select: { id: true, name: true, timezone: true, openingHours: { select: { weekday: true, opensAt: true, closesAt: true } } },
    });
    if (!establishment) throw notFound('Restaurante não encontrado.');

    const clock = localClock(startsAt, establishment.timezone);
    if (clock.minutes % BOOKING_SLOT_STEP_MINUTES !== 0) throw unprocessable('INVALID_BOOKING_TIME', `Escolha um horário de ${BOOKING_SLOT_STEP_MINUTES} em ${BOOKING_SLOT_STEP_MINUTES} minutos.`);
    const open = activeRange(establishment.openingHours, clock) !== null;

    const endsAt = new Date(startsAt.getTime() + DURATION_MS);
    const result = await this.prisma.$transaction(async tx => {
      await lockResource(tx, `booking:${establishment.id}`);
      const mine = await tx.booking.findFirst({
        where: { userId, establishmentId: establishment.id, status: { in: BLOCKING }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
        select: { id: true },
      });
      if (mine) throw conflict('BOOKING_OVERLAP', 'Você já tem uma reserva neste restaurante nesse horário.');

      let tableId: string | null = null;
      let refusalReason: string | null = null;
      if (!open) refusalReason = 'O restaurante está fechado nesse horário.';
      else {
        const tables = await tx.diningTable.findMany({ where: { establishmentId: establishment.id }, select: { id: true, label: true, capacity: true } });
        if (tables.length === 0) refusalReason = 'O restaurante ainda não aceita reservas de mesa.';
        else {
          const occupations = await this.occupations(tx, establishment.id, startsAt, endsAt);
          const table = pickTable(tables, dto.partySize, occupations, startsAt.getTime(), endsAt.getTime());
          if (table) tableId = table.id;
          else refusalReason = tables.some(t => t.capacity >= dto.partySize) ? 'Não há mesa livre nesse horário. Tente outro horário.' : `Nenhuma mesa comporta ${dto.partySize} pessoas.`;
        }
      }
      return tx.booking.create({
        data: { establishmentId: establishment.id, userId, tableId, partySize: dto.partySize, startsAt, endsAt, status: tableId ? 'confirmed' : 'refused', refusalReason },
        include: BOOKING_INCLUDE,
      });
    });

    const when = this.format(startsAt, establishment.timezone);
    await this.inbox.notifyUser(userId, {
      kind: result.status === 'confirmed' ? 'booking_confirmed' : 'booking_refused',
      title: result.status === 'confirmed' ? `Reserva confirmada em ${establishment.name}` : `Reserva não confirmada em ${establishment.name}`,
      body: result.status === 'confirmed' ? `Mesa para ${dto.partySize} ${dto.partySize === 1 ? 'pessoa' : 'pessoas'} em ${when}.` : `${result.refusalReason ?? 'Sem disponibilidade'} (${when}, ${dto.partySize} ${dto.partySize === 1 ? 'pessoa' : 'pessoas'}).`,
      refId: result.id,
      dedupeKey: `booking:${result.id}:${result.status}`,
      email: true,
    });
    this.realtime.bookingsUpdated(establishment.id, userId);
    return toDto(result);
  }

  async listMine(userId: string): Promise<BookingDto[]> {
    const rows = await this.prisma.booking.findMany({ where: { userId }, orderBy: { startsAt: 'desc' }, take: 50, include: BOOKING_INCLUDE });
    return rows.map(row => toDto(row));
  }

  async cancelMine(userId: string, bookingId: string, now = new Date()): Promise<BookingDto> {
    const current = await this.prisma.booking.findFirst({ where: { id: bookingId, userId }, select: { id: true, status: true, startsAt: true, establishmentId: true } });
    if (!current) throw notFound('Reserva não encontrada.');
    if (current.status !== 'confirmed' || current.startsAt <= now) throw conflict('BOOKING_NOT_CANCELLABLE', 'Esta reserva não pode mais ser cancelada.');
    const { count } = await this.prisma.booking.updateMany({ where: { id: bookingId, status: 'confirmed' }, data: { status: 'cancelled', cancelledAt: now } });
    if (count === 0) throw conflict('BOOKING_NOT_CANCELLABLE', 'Esta reserva não pode mais ser cancelada.');
    this.realtime.bookingsUpdated(current.establishmentId, userId);
    return this.get(bookingId);
  }

  /** Horários do dia (de 30 em 30 min dentro do funcionamento) com a disponibilidade para o grupo. */
  async slots(establishmentId: string, date: string, partySize: number, now = new Date()): Promise<BookingSlotsDto> {
    const establishment = await this.prisma.establishment.findFirst({
      where: { id: establishmentId, status: 'active' },
      select: { id: true, timezone: true, openingHours: { select: { weekday: true, opensAt: true, closesAt: true } } },
    });
    if (!establishment) throw notFound('Restaurante não encontrado.');
    const dayStart = zonedInstant(date, 0, establishment.timezone);
    if (!dayStart) throw unprocessable('INVALID_DATE', 'Data inválida.');
    const weekday = localClock(new Date(dayStart.getTime() + 12 * 3_600_000), establishment.timezone).weekday;
    const ranges: OpeningRange[] = establishment.openingHours.filter(range => range.weekday === weekday);

    const tables = await this.prisma.diningTable.findMany({ where: { establishmentId }, select: { id: true, label: true, capacity: true } });
    const from = new Date(dayStart.getTime());
    const to = new Date(dayStart.getTime() + 2 * 86_400_000);
    const occupations = await this.occupations(this.prisma, establishmentId, from, to);

    const slots: BookingSlotsDto['slots'] = [];
    for (const range of ranges) {
      const closes = range.closesAt <= range.opensAt ? range.closesAt + 1440 : range.closesAt;
      for (let minutes = range.opensAt; minutes <= closes - BOOKING_SLOT_STEP_MINUTES; minutes += BOOKING_SLOT_STEP_MINUTES) {
        const startsAt = zonedInstant(date, minutes, establishment.timezone) as Date;
        const bookable = startsAt.getTime() >= now.getTime() + BOOKING_MIN_LEAD_MINUTES * 60_000 && startsAt.getTime() <= now.getTime() + BOOKING_MAX_DAYS_AHEAD * 86_400_000;
        const free = bookable && pickTable(tables, partySize, occupations, startsAt.getTime(), startsAt.getTime() + DURATION_MS) !== null;
        slots.push({ startsAt: startsAt.toISOString(), label: formatMinutes(minutes), available: free });
      }
    }
    slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return { date, timezone: establishment.timezone, slots };
  }

  // ─── Equipe ───────────────────────────────────────────────────────────────

  /** Reservas a partir de hoje (fuso da casa), por horário; `status` filtra. */
  async listForStaff(establishmentId: string, query: { date?: string; status?: BookingStatus; includePast?: boolean }, now = new Date()): Promise<BookingDto[]> {
    const establishment = await this.prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { timezone: true } });
    const day = query.date ?? localDate(now, establishment.timezone);
    const start = zonedInstant(day, 0, establishment.timezone);
    if (!start) throw unprocessable('INVALID_DATE', 'Data inválida.');
    const rows = await this.prisma.booking.findMany({
      where: {
        establishmentId,
        ...(query.status && { status: query.status }),
        startsAt: query.date ? { gte: start, lt: new Date(start.getTime() + 86_400_000) } : { gte: query.includePast ? new Date(0) : start },
      },
      orderBy: { startsAt: 'asc' },
      take: 200,
      include: BOOKING_INCLUDE,
    });
    return rows.map(row => toDto(row, true));
  }

  /** A casa cancela uma reserva confirmada (imprevisto): o cliente é avisado. */
  async cancelForStaff(establishmentId: string, bookingId: string, actorId: string): Promise<BookingDto> {
    const current = await this.prisma.booking.findFirst({ where: { id: bookingId, establishmentId }, include: BOOKING_INCLUDE });
    if (!current) throw notFound('Reserva não encontrada.');
    const { count } = await this.prisma.booking.updateMany({ where: { id: bookingId, status: 'confirmed' }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actorId } });
    if (count === 0) throw conflict('BOOKING_NOT_CANCELLABLE', 'Só reservas confirmadas podem ser canceladas.');
    const tz = (await this.prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { timezone: true } })).timezone;
    await this.inbox.notifyUser(current.userId, {
      kind: 'booking_cancelled',
      title: `Reserva cancelada por ${current.establishment.name}`,
      body: `A reserva de ${this.format(current.startsAt, tz)} foi cancelada pelo restaurante. Entre em contato ou faça uma nova reserva.`,
      refId: bookingId,
      dedupeKey: `booking:${bookingId}:cancelled`,
      email: true,
    });
    this.realtime.bookingsUpdated(establishmentId, current.userId);
    return this.get(bookingId, true);
  }

  /** Cliente chegou e foi acomodado: encerra a reserva como atendida. */
  async seat(establishmentId: string, bookingId: string): Promise<BookingDto> {
    const current = await this.prisma.booking.findFirst({ where: { id: bookingId, establishmentId }, select: { userId: true } });
    if (!current) throw notFound('Reserva não encontrada.');
    const { count } = await this.prisma.booking.updateMany({ where: { id: bookingId, status: 'confirmed' }, data: { status: 'seated' } });
    if (count === 0) throw conflict('BOOKING_NOT_SEATABLE', 'Só reservas confirmadas podem ser marcadas como atendidas.');
    this.realtime.bookingsUpdated(establishmentId, current.userId);
    return this.get(bookingId, true);
  }

  // ─── Internos ─────────────────────────────────────────────────────────────

  private async get(id: string, includeCustomer = false): Promise<BookingDto> {
    return toDto(await this.prisma.booking.findUniqueOrThrow({ where: { id }, include: BOOKING_INCLUDE }), includeCustomer);
  }

  /** Mesas ocupadas no intervalo: reservas de clientes ativas e reservas feitas pela equipe (ficha 16). */
  private async occupations(client: Pick<PrismaService, 'booking' | 'tableReservation'>, establishmentId: string, from: Date, to: Date): Promise<Occupation[]> {
    const [bookings, staff] = await Promise.all([
      client.booking.findMany({ where: { establishmentId, status: { in: BLOCKING }, tableId: { not: null }, startsAt: { lt: to }, endsAt: { gt: from } }, select: { tableId: true, startsAt: true, endsAt: true } }),
      client.tableReservation.findMany({
        where: { establishmentId, closedAt: null, reservedAt: { lt: to, gt: new Date(from.getTime() - STAFF_RESERVATION_MS) } },
        select: { tableId: true, reservedAt: true },
      }),
    ]);
    return [
      ...bookings.map(b => ({ tableId: b.tableId as string, from: b.startsAt.getTime(), to: b.endsAt.getTime() })),
      ...staff.map(r => ({ tableId: r.tableId, from: r.reservedAt.getTime(), to: r.reservedAt.getTime() + STAFF_RESERVATION_MS })),
    ];
  }

  private format(instant: Date, timeZone: string) {
    return new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(instant);
  }
}
