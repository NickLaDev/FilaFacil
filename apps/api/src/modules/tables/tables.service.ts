import { Injectable } from '@nestjs/common';
import type {
  CreatedTableCallDto,
  TableCallDto,
  TableCheckDto,
  TableMapDto,
  TableMapGroupDto,
  TableMapTableDto,
  TableReservationDto,
  TableState,
} from '@filafacil/shared';
import { conflict, notFound, unprocessable } from '../../common/http/app-error.js';
import { lockResource } from '../../database/advisory-lock.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { WaitlistService } from '../waitlist/waitlist.service.js';
import type { CreateReservationDto, MergeTablesDto } from './dto/tables.dto.js';
import { tableScope } from './table-state.js';

const MAP_SELECT = {
  id: true,
  label: true,
  shape: true,
  capacity: true,
  positionX: true,
  positionY: true,
  qrCode: true,
  occupancy: true,
  occupiedPartySize: true,
  occupiedSince: true,
  groupId: true,
  calls: { where: { resolvedAt: null }, take: 1, select: { id: true, createdAt: true } },
  reservations: { where: { closedAt: null }, take: 1, select: { id: true, name: true, partySize: true, reservedAt: true } },
} satisfies Prisma.DiningTableSelect;

type MapRow = Prisma.DiningTableGetPayload<{ select: typeof MAP_SELECT }>;

/** Pedidos que entram na conta: já pagos (não cancelados nem aguardando pagamento). */
const CHECK_STATUSES = ['paid', 'preparing', 'ready', 'delivered'] as const;

const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true });

const callDto = (call: MapRow['calls'][number] | undefined): TableCallDto | null =>
  call ? { id: call.id, createdAt: call.createdAt.toISOString() } : null;

const reservationDto = (reservation: MapRow['reservations'][number] | undefined): TableReservationDto | null =>
  reservation ? { id: reservation.id, name: reservation.name, partySize: reservation.partySize, reservedAt: reservation.reservedAt.toISOString() } : null;

/** Chamado > ocupada > reservada > livre. */
const stateOf = (rows: MapRow[]): TableState =>
  rows.some(row => row.calls.length) ? 'called' : rows.some(row => row.occupancy === 'occupied') ? 'occupied' : rows.some(row => row.reservations.length) ? 'reserved' : 'free';

/**
 * Fichas 16 e 47: mapa de mesas do atendente. O estado vem do banco a cada leitura (ocupação,
 * chamados abertos e reservas ativas) e cada alteração avisa a equipe pelo evento `tables.updated`.
 * Mesas mescladas formam um grupo: ações, estado e conta valem para o grupo todo.
 */
@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly waitlist: WaitlistService,
  ) {}

  // ─── Leitura ──────────────────────────────────────────────────────────────

  async map(establishmentId: string): Promise<TableMapDto> {
    const rows = await this.prisma.diningTable.findMany({ where: { establishmentId }, orderBy: { createdAt: 'asc' }, select: MAP_SELECT });
    const tables: TableMapTableDto[] = rows.map(row => ({
      id: row.id,
      label: row.label,
      shape: row.shape,
      capacity: row.capacity,
      x: row.positionX,
      y: row.positionY,
      qrCode: row.qrCode,
      status: stateOf([row]),
      partySize: row.occupancy === 'occupied' ? (row.occupiedPartySize ?? 0) : 0,
      since: row.occupiedSince?.toISOString() ?? null,
      pendingCall: callDto(row.calls[0]),
      reservation: reservationDto(row.reservations[0]),
      groupId: row.groupId,
    }));

    const members = new Map<string, MapRow[]>();
    for (const row of rows) if (row.groupId) members.set(row.groupId, [...(members.get(row.groupId) ?? []), row]);
    const groups: TableMapGroupDto[] = [...members.entries()].map(([id, group]) => {
      const sorted = [...group].sort(byLabel);
      const since = group.flatMap(row => (row.occupiedSince ? [row.occupiedSince] : [])).sort((a, b) => a.getTime() - b.getTime())[0];
      return {
        id,
        tableIds: sorted.map(row => row.id),
        label: sorted.map(row => row.label).join(' + '),
        capacity: group.reduce((sum, row) => sum + row.capacity, 0),
        x: group.reduce((sum, row) => sum + row.positionX, 0) / group.length,
        y: group.reduce((sum, row) => sum + row.positionY, 0) / group.length,
        status: stateOf(group),
        partySize: group.reduce((sum, row) => sum + (row.occupancy === 'occupied' ? (row.occupiedPartySize ?? 0) : 0), 0),
        since: since?.toISOString() ?? null,
        pendingCall: callDto(sorted.flatMap(row => row.calls)[0]),
        reservation: reservationDto(sorted.flatMap(row => row.reservations)[0]),
      };
    });
    return { establishmentId, tables, groups };
  }

  private notify(establishmentId: string) {
    this.realtime.tablesUpdated(establishmentId);
  }

  /** Mesa (ou o grupo dela) do estabelecimento; qualquer outra responde 404. */
  private async scopeOrFail(tx: PrismaTx, establishmentId: string, tableId: string) {
    const ids = await tableScope(tx, tableId, establishmentId);
    if (!ids.length) throw notFound('Mesa não encontrada.');
    return ids;
  }

  // ─── Ocupação (manual) ────────────────────────────────────────────────────

  /** Atendente senta clientes: marca ocupada com o número de pessoas e encerra a reserva da mesa. */
  async occupy(establishmentId: string, tableId: string, partySize: number): Promise<TableMapDto> {
    await this.prisma.$transaction(async tx => {
      await lockResource(tx, `tables:${establishmentId}`);
      const ids = await this.scopeOrFail(tx, establishmentId, tableId);
      const tables = (await tx.diningTable.findMany({ where: { id: { in: ids } }, select: { id: true, label: true, occupancy: true, occupiedSince: true } })).sort(byLabel);
      const now = new Date();
      for (const [index, table] of tables.entries()) {
        await tx.diningTable.update({
          where: { id: table.id },
          // Num grupo, o total de pessoas fica na primeira mesa.
          data: { occupancy: 'occupied', occupiedPartySize: index === 0 ? partySize : 0, occupiedSince: table.occupancy === 'occupied' ? table.occupiedSince : now },
        });
      }
      await tx.tableReservation.updateMany({ where: { tableId: { in: ids }, closedAt: null }, data: { closedAt: now } });
    });
    this.notify(establishmentId);
    return this.map(establishmentId);
  }

  /** Libera a mesa (ou o grupo) e avisa o próximo grupo da fila de espera, como na ficha 21. */
  async release(establishmentId: string, tableId: string): Promise<TableMapDto> {
    const ids = await this.prisma.$transaction(tx => this.scopeOrFail(tx, establishmentId, tableId));
    await this.waitlist.releaseTables(establishmentId, ids);
    this.notify(establishmentId);
    return this.map(establishmentId);
  }

  // ─── Reservas ─────────────────────────────────────────────────────────────

  async reserve(establishmentId: string, tableId: string, dto: CreateReservationDto, actorId: string): Promise<TableMapDto> {
    await this.prisma.$transaction(async tx => {
      await lockResource(tx, `tables:${establishmentId}`);
      const ids = await this.scopeOrFail(tx, establishmentId, tableId);
      const tables = await tx.diningTable.findMany({ where: { id: { in: ids } }, select: { id: true, label: true, occupancy: true, reservations: { where: { closedAt: null }, select: { id: true } } } });
      if (tables.some(table => table.occupancy === 'occupied')) throw conflict('TABLE_OCCUPIED', 'A mesa está ocupada.');
      if (tables.some(table => table.reservations.length)) throw conflict('TABLE_ALREADY_RESERVED', 'A mesa já tem uma reserva ativa.');
      const [first] = tables.sort(byLabel);
      await tx.tableReservation.create({
        data: { establishmentId, tableId: first?.id as string, name: dto.name, partySize: dto.partySize, reservedAt: dto.reservedAt ?? new Date(), createdById: actorId },
      });
    });
    this.notify(establishmentId);
    return this.map(establishmentId);
  }

  async cancelReservation(establishmentId: string, tableId: string, reservationId: string): Promise<TableMapDto> {
    await this.prisma.$transaction(async tx => {
      const ids = await this.scopeOrFail(tx, establishmentId, tableId);
      const closed = await tx.tableReservation.updateMany({ where: { id: reservationId, tableId: { in: ids }, closedAt: null }, data: { closedAt: new Date() } });
      if (closed.count === 0) throw notFound('Reserva não encontrada.');
    });
    this.notify(establishmentId);
    return this.map(establishmentId);
  }

  // ─── Chamados do cliente ──────────────────────────────────────────────────

  /** Cliente chama o atendente. Enquanto houver chamado aberto na mesa, repetir devolve o mesmo. */
  async createCall(userId: string, tableId: string): Promise<CreatedTableCallDto> {
    const table = await this.prisma.diningTable.findUnique({ where: { id: tableId }, select: { id: true, establishmentId: true, establishment: { select: { status: true } } } });
    if (!table || table.establishment.status !== 'active') throw notFound('Mesa não encontrada.');
    const open = () => this.prisma.tableCall.findFirst({ where: { tableId, resolvedAt: null } });
    let call = await open();
    if (!call) {
      try {
        call = await this.prisma.tableCall.create({ data: { tableId, establishmentId: table.establishmentId, userId } });
        this.notify(table.establishmentId);
      } catch (error) {
        // Dois chamados simultâneos: o índice único parcial deixa passar só um.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        call = await open();
      }
    }
    if (!call) throw unprocessable('CALL_FAILED', 'Não foi possível registrar o chamado. Tente novamente.');
    return { id: call.id, tableId, createdAt: call.createdAt.toISOString() };
  }

  /** Atendente atendeu o chamado da mesa (ou de qualquer mesa do grupo). */
  async resolveCalls(establishmentId: string, tableId: string, actorId: string): Promise<TableMapDto> {
    await this.prisma.$transaction(async tx => {
      const ids = await this.scopeOrFail(tx, establishmentId, tableId);
      await tx.tableCall.updateMany({ where: { tableId: { in: ids }, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: actorId } });
    });
    this.notify(establishmentId);
    return this.map(establishmentId);
  }

  // ─── Mesclar mesas (ficha 47) ─────────────────────────────────────────────

  async merge(establishmentId: string, dto: MergeTablesDto, actorId: string): Promise<TableMapDto> {
    await this.prisma.$transaction(async tx => {
      await lockResource(tx, `tables:${establishmentId}`);
      const tables = await tx.diningTable.findMany({ where: { id: { in: dto.tableIds }, establishmentId }, select: { id: true, groupId: true } });
      if (tables.length !== dto.tableIds.length) throw notFound('Mesa não encontrada.');
      if (tables.some(table => table.groupId)) throw conflict('TABLE_ALREADY_MERGED', 'Uma das mesas já está mesclada. Desfaça a mescla antes.');
      const group = await tx.tableGroup.create({ data: { establishmentId, createdById: actorId }, select: { id: true } });
      await tx.diningTable.updateMany({ where: { id: { in: dto.tableIds } }, data: { groupId: group.id } });
    });
    this.notify(establishmentId);
    return this.map(establishmentId);
  }

  /** Desfaz a mescla: cada mesa volta a ser uma unidade com o estado que tinha. */
  async unmerge(establishmentId: string, groupId: string): Promise<TableMapDto> {
    await this.prisma.$transaction(async tx => {
      await lockResource(tx, `tables:${establishmentId}`);
      const deleted = await tx.tableGroup.deleteMany({ where: { id: groupId, establishmentId } });
      if (deleted.count === 0) throw notFound('Grupo de mesas não encontrado.');
    });
    this.notify(establishmentId);
    return this.map(establishmentId);
  }

  // ─── Conta consolidada ────────────────────────────────────────────────────

  /**
   * Conta da mesa ou do grupo: pedidos pagos desde que a mesa foi ocupada (ou o grupo criado), reaproveitando
   * os pedidos e pagamentos existentes. Mesa livre e sem grupo não tem conta aberta.
   */
  async check(establishmentId: string, tableId: string): Promise<TableCheckDto> {
    const ids = await this.prisma.$transaction(tx => this.scopeOrFail(tx, establishmentId, tableId));
    const tables = (await this.prisma.diningTable.findMany({ where: { id: { in: ids } }, select: { id: true, label: true, occupiedSince: true, group: { select: { createdAt: true } } } })).sort(byLabel);
    const since = [...tables.flatMap(table => (table.occupiedSince ? [table.occupiedSince] : [])), ...tables.flatMap(table => (table.group ? [table.group.createdAt] : []))].sort(
      (a, b) => a.getTime() - b.getTime(),
    )[0];
    const label = tables.map(table => table.label).join(' + ');
    if (!since) return { tableIds: ids, label, orders: [], totalCents: 0, paidCents: 0 };

    const orders = await this.prisma.order.findMany({
      where: {
        establishmentId,
        tableId: { in: ids },
        status: { in: [...CHECK_STATUSES] },
        payments: { some: { status: 'approved', approvedAt: { gte: since } } },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        number: true,
        tableLabel: true,
        status: true,
        totalCents: true,
        items: { orderBy: { name: 'asc' }, select: { menuItemId: true, name: true, quantity: true, unitPriceCents: true, notes: true } },
        payments: { where: { status: 'approved' }, select: { amountCents: true } },
      },
    });
    return {
      tableIds: ids,
      label,
      orders: orders.map(order => ({ id: order.id, number: order.number, tableLabel: order.tableLabel, status: order.status, totalCents: order.totalCents, items: order.items })),
      totalCents: orders.reduce((sum, order) => sum + order.totalCents, 0),
      paidCents: orders.reduce((sum, order) => sum + order.payments.reduce((paid, payment) => paid + payment.amountCents, 0), 0),
    };
  }
}
