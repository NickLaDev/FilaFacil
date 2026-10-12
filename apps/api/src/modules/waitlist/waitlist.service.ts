import { Injectable, Logger } from '@nestjs/common';
import { isValidPhone, normalizePhone, type MyReservationDto, type MyReservationsDto, type MyReservationStateDto, type WaitlistDto, type WaitlistEntryDto } from '@filafacil/shared';
import { BRAND_NAME } from '../../common/brand.js';
import { badRequest, conflict, forbidden, notFound } from '../../common/http/app-error.js';
import { maskPhone } from '../../common/masking.js';
import { lockResource } from '../../database/advisory-lock.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import type { WaitlistEntry } from '../../generated/prisma/client.js';
import { EntitlementsService } from '../access/entitlements.service.js';
import { RestaurantsService } from '../restaurants/restaurants.service.js';
import { SmsSender } from '../notifications/message-senders.js';
import { tableScope } from '../tables/table-state.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { CreateWaitlistEntryDto } from './dto/waitlist.dto.js';
import { estimateWaitMinutes, releasedTablesLabel } from './wait-estimate.js';

const ACTIVE_STATUSES = ['waiting', 'notified'] as const;

interface FreeTable {
  capacity: number;
}

/**
 * Ficha 21: fila de espera por estabelecimento. Toda mudança de ordem acontece sob um lock
 * transacional da fila (pg_advisory_xact_lock), então requisições simultâneas nunca recebem a
 * mesma posição nem embaralham a ordem.
 */
@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsSender,
    private readonly realtime: RealtimeService,
    private readonly entitlements: EntitlementsService,
    private readonly restaurants: RestaurantsService,
  ) {}

  private lock(tx: PrismaTx, establishmentId: string) {
    return lockResource(tx, `waitlist:${establishmentId}`);
  }

  private activeEntries(tx: PrismaTx | PrismaService, establishmentId: string) {
    return tx.waitlistEntry.findMany({
      where: { establishmentId, status: { in: [...ACTIVE_STATUSES] } },
      orderBy: { position: 'asc' },
    });
  }

  private freeTables(tx: PrismaTx | PrismaService, establishmentId: string): Promise<FreeTable[]> {
    return tx.diningTable.findMany({ where: { establishmentId, occupancy: 'free' }, select: { capacity: true } });
  }

  async list(establishmentId: string): Promise<WaitlistDto> {
    const [entries, freeTables] = await Promise.all([this.activeEntries(this.prisma, establishmentId), this.freeTables(this.prisma, establishmentId)]);
    return { entries: this.toDtos(entries, freeTables), freeTables: freeTables.length };
  }

  async add(establishmentId: string, dto: CreateWaitlistEntryDto, actorId: string): Promise<WaitlistEntryDto> {
    const phone = normalizePhone(dto.phone);
    if (!isValidPhone(phone)) throw badRequest('VALIDATION_FAILED', 'Dados inválidos.', [{ field: 'phone', message: 'Celular inválido.' }]);
    return this.enqueue(establishmentId, { name: dto.name, phone, partySize: dto.partySize, createdById: actorId });
  }

  /** Entrada no fim da fila sob o lock da fila; `customerId` marca a reserva feita pelo próprio cliente. */
  private async enqueue(
    establishmentId: string,
    data: { name: string; phone: string; partySize: number; createdById?: string; customerId?: string },
  ): Promise<WaitlistEntryDto> {
    const created = await this.prisma.$transaction(async tx => {
      await this.lock(tx, establishmentId);
      if (data.customerId) {
        const existing = await tx.waitlistEntry.findFirst({
          where: { establishmentId, customerId: data.customerId, status: { in: [...ACTIVE_STATUSES] } },
          select: { id: true },
        });
        if (existing) throw conflict('ALREADY_RESERVED', 'Você já está na fila deste restaurante.');
      }
      // Sequencial: uma transação usa uma única conexão.
      const entries = await this.activeEntries(tx, establishmentId);
      const freeTables = await this.freeTables(tx, establishmentId);
      const waitingAhead = entries.filter(entry => entry.status === 'waiting').length;
      const compatible = freeTables.filter(table => table.capacity >= data.partySize).length;
      const entry = await tx.waitlistEntry.create({
        data: {
          establishmentId,
          name: data.name,
          phone: data.phone,
          partySize: data.partySize,
          position: (entries.at(-1)?.position ?? 0) + 1,
          quotedWaitMinutes: estimateWaitMinutes(waitingAhead, compatible),
          createdById: data.createdById ?? null,
          customerId: data.customerId ?? null,
        },
      });
      return { entry, entries: [...entries, entry], freeTables };
    });
    this.realtime.waitlistUpdated(establishmentId);
    return this.toDtos(created.entries, created.freeTables).find(entry => entry.id === created.entry.id) as WaitlistEntryDto;
  }

  // ─── Reserva do cliente (ficha 12) ─────────────────────────────────────────

  /** Estado da reserva do cliente neste restaurante (botão "Reservar" / "Sua reserva"). */
  async myReservation(establishmentId: string, userId: string): Promise<MyReservationStateDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
    const { entries } = await this.list(establishmentId);
    const mine = await this.prisma.waitlistEntry.findFirst({
      where: { establishmentId, customerId: userId, status: { in: [...ACTIVE_STATUSES] } },
      select: { id: true },
    });
    const entry = entries.find(item => item.id === mine?.id);
    return { hasPhone: Boolean(user.phone), reservation: entry ? this.toMyReservation(entry) : null };
  }

  /** Reservas ativas do cliente em todos os restaurantes (atalho do perfil). */
  async myReservations(userId: string): Promise<MyReservationsDto> {
    const mine = await this.prisma.waitlistEntry.findMany({
      where: { customerId: userId, status: { in: [...ACTIVE_STATUSES] } },
      orderBy: { joinedAt: 'desc' },
      select: { id: true, establishmentId: true, establishment: { select: { name: true } } },
    });
    const items: MyReservationsDto['items'] = [];
    for (const row of mine) {
      const { entries } = await this.list(row.establishmentId);
      const entry = entries.find(item => item.id === row.id);
      if (entry) items.push({ ...this.toMyReservation(entry), restaurantId: row.establishmentId, restaurantName: row.establishment.name });
    }
    return { items };
  }

  /**
   * "Reservar": o cliente logado entra no fim da fila de espera do restaurante (a mesma que a equipe
   * gerencia na ficha 21), com o nome da conta e um celular para o aviso de mesa pronta.
   */
  async reserve(establishmentId: string, userId: string, input: { partySize: number; phone?: string }): Promise<MyReservationDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, phone: true, role: true, deletedAt: true } });
    if (user.role !== 'client' || user.deletedAt) throw forbidden('CLIENT_ONLY', 'Somente clientes podem reservar mesa.');
    const detail = await this.restaurants.detail(establishmentId);
    if (!detail.isOpenNow) throw conflict('RESTAURANT_CLOSED', 'O restaurante está fechado no momento.');
    if (!(await this.entitlements.featuresFor(establishmentId)).has('waitlist')) {
      throw conflict('RESERVATIONS_UNAVAILABLE', 'Este restaurante não aceita reservas pelo aplicativo.');
    }
    const phone = normalizePhone(input.phone ?? user.phone ?? '');
    if (!isValidPhone(phone)) throw badRequest('VALIDATION_FAILED', 'Dados inválidos.', [{ field: 'phone', message: 'Informe um celular válido para o aviso.' }]);
    const entry = await this.enqueue(establishmentId, { name: user.name, phone, partySize: input.partySize, customerId: userId });
    return this.toMyReservation(entry);
  }

  /** Cliente desiste da reserva: sai da fila e as posições seguintes sobem. */
  async cancelReservation(establishmentId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await this.lock(tx, establishmentId);
      const entry = await tx.waitlistEntry.findFirst({
        where: { establishmentId, customerId: userId, status: { in: [...ACTIVE_STATUSES] } },
        select: { id: true },
      });
      if (!entry) throw notFound('Você não tem reserva neste restaurante.');
      await this.closeEntry(tx, establishmentId, entry.id, 'removed');
    });
    this.realtime.waitlistUpdated(establishmentId);
  }

  private toMyReservation(entry: WaitlistEntryDto): MyReservationDto {
    return {
      id: entry.id,
      partySize: entry.partySize,
      position: entry.position,
      status: entry.status,
      joinedAt: entry.joinedAt,
      quotedWaitMinutes: entry.quotedWaitMinutes,
      estimatedWaitMinutes: entry.estimatedWaitMinutes,
      notifiedTableLabel: entry.notifiedTableLabel,
    };
  }

  /** Reordenação manual: move o grupo para a posição pedida e reposiciona os demais. */
  async move(establishmentId: string, entryId: string, targetPosition: number): Promise<WaitlistDto> {
    await this.prisma.$transaction(async tx => {
      await this.lock(tx, establishmentId);
      const entries = await this.activeEntries(tx, establishmentId);
      const index = entries.findIndex(entry => entry.id === entryId);
      if (index === -1) throw notFound('Grupo não está na fila.');
      const reordered = [...entries];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(Math.min(targetPosition, entries.length) - 1, 0, moved as WaitlistEntry);

      // Posições negativas temporárias evitam colisão no índice único durante a troca.
      await tx.waitlistEntry.updateMany({
        where: { establishmentId, status: { in: [...ACTIVE_STATUSES] } },
        data: { position: { multiply: -1 } },
      });
      for (const [order, entry] of reordered.entries()) {
        await tx.waitlistEntry.update({ where: { id: entry.id }, data: { position: order + 1 } });
      }
    });
    this.realtime.waitlistUpdated(establishmentId);
    return this.list(establishmentId);
  }

  /** "Notificar"/"Avisar de novo": reenvia o aviso de mesa pronta. */
  async notify(establishmentId: string, entryId: string): Promise<WaitlistEntryDto> {
    const entry = await this.prisma.$transaction(async tx => {
      await this.lock(tx, establishmentId);
      const current = await tx.waitlistEntry.findFirst({ where: { id: entryId, establishmentId, status: { in: [...ACTIVE_STATUSES] } } });
      if (!current) throw notFound('Grupo não está na fila.');
      return tx.waitlistEntry.update({ where: { id: entryId }, data: { status: 'notified', notifiedAt: new Date() } });
    });
    await this.sendTableReady(entry);
    this.realtime.waitlistUpdated(establishmentId);
    return this.entryDto(establishmentId, entry.id);
  }

  /** Grupo acomodado: sai da fila e, se foi avisado com mesas, elas passam a constar como ocupadas. */
  async seat(establishmentId: string, entryId: string) {
    const occupiedTables = await this.prisma.$transaction(async tx => {
      await this.lock(tx, establishmentId);
      const entry = await this.closeEntry(tx, establishmentId, entryId, 'seated');
      if (!entry.notifiedTableIds.length) return false;
      const now = new Date();
      const [first, ...rest] = entry.notifiedTableIds;
      await tx.diningTable.updateMany({
        where: { id: first, establishmentId, occupancy: 'free' },
        data: { occupancy: 'occupied', occupiedPartySize: entry.partySize, occupiedSince: now },
      });
      if (rest.length) {
        await tx.diningTable.updateMany({
          where: { id: { in: rest }, establishmentId, occupancy: 'free' },
          data: { occupancy: 'occupied', occupiedPartySize: 0, occupiedSince: now },
        });
      }
      return true;
    });
    this.realtime.waitlistUpdated(establishmentId);
    if (occupiedTables) this.realtime.floorPlanUpdated(establishmentId);
  }

  async remove(establishmentId: string, entryId: string) {
    await this.prisma.$transaction(async tx => {
      await this.lock(tx, establishmentId);
      await this.closeEntry(tx, establishmentId, entryId, 'removed');
    });
    this.realtime.waitlistUpdated(establishmentId);
  }

  /**
   * Ao liberar mesa(s), o primeiro grupo da fila que cabe nelas é avisado na mesma hora
   * (avaliação da ficha 21: em até 10 segundos). Mesas liberadas juntas somam a capacidade.
   */
  async releaseTables(establishmentId: string, tableIds: string[]) {
    const result = await this.prisma.$transaction(async tx => {
      await this.lock(tx, establishmentId);
      await lockResource(tx, `tables:${establishmentId}`);
      // Mesa mesclada é liberada junto com o grupo todo.
      const scopes = await Promise.all(tableIds.map(id => tableScope(tx, id, establishmentId)));
      if (scopes.some(scope => scope.length === 0)) throw notFound('Mesa não encontrada neste estabelecimento.');
      tableIds = [...new Set(scopes.flat())];
      const tables = await tx.diningTable.findMany({
        where: { id: { in: tableIds }, establishmentId },
        orderBy: { label: 'asc' },
        select: { id: true, label: true, capacity: true },
      });
      if (tables.length !== tableIds.length) throw notFound('Mesa não encontrada neste estabelecimento.');
      await tx.diningTable.updateMany({
        where: { id: { in: tableIds } },
        data: { occupancy: 'free', occupiedPartySize: null, occupiedSince: null },
      });

      const capacity = tables.reduce((sum, table) => sum + table.capacity, 0);
      const next = await tx.waitlistEntry.findFirst({
        where: { establishmentId, status: 'waiting', partySize: { lte: capacity } },
        orderBy: { position: 'asc' },
      });
      if (!next) return null;
      return tx.waitlistEntry.update({
        where: { id: next.id },
        data: {
          status: 'notified',
          notifiedAt: new Date(),
          notifiedTableLabel: releasedTablesLabel(tables.map(table => table.label)),
          notifiedTableIds: tables.map(table => table.id),
        },
      });
    });

    if (result) await this.sendTableReady(result);
    this.realtime.waitlistUpdated(establishmentId);
    this.realtime.floorPlanUpdated(establishmentId);
    return { notifiedEntry: result ? await this.entryDto(establishmentId, result.id) : null };
  }

  private async closeEntry(tx: PrismaTx, establishmentId: string, entryId: string, status: 'seated' | 'removed') {
    const entry = await tx.waitlistEntry.findFirst({ where: { id: entryId, establishmentId, status: { in: [...ACTIVE_STATUSES] } } });
    if (!entry) throw notFound('Grupo não está na fila.');
    return tx.waitlistEntry.update({ where: { id: entryId }, data: { status, closedAt: new Date() } });
  }

  /**
   * Aviso de mesa pronta pelo canal configurado (SMS). Sem provider, o evento é registrado como
   * "skipped" e o painel continua mostrando o grupo como notificado para o aviso presencial.
   */
  private async sendTableReady(entry: WaitlistEntry) {
    const destinationMasked = maskPhone(entry.phone);
    const table = entry.notifiedTableLabel ? ` (${entry.notifiedTableLabel})` : '';
    const message = `${BRAND_NAME}: ${entry.name.split(' ')[0]}, sua mesa está pronta${table}! Procure a recepção.`;
    let status: 'sent' | 'failed' | 'skipped' = 'skipped';
    if (this.sms.available) {
      try {
        await this.sms.send(entry.phone, destinationMasked, message);
        status = 'sent';
      } catch (error) {
        status = 'failed';
        this.logger.warn(`Falha ao avisar ${destinationMasked}: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
      }
    }
    await this.prisma.waitlistNotification.create({
      data: { entryId: entry.id, channel: 'sms', destinationMasked, tableLabel: entry.notifiedTableLabel, status, provider: this.sms.provider },
    });
  }

  private async entryDto(establishmentId: string, entryId: string): Promise<WaitlistEntryDto> {
    const { entries } = await this.list(establishmentId);
    const entry = entries.find(item => item.id === entryId);
    if (!entry) throw notFound('Grupo não está na fila.');
    return entry;
  }

  /** Posição exibida e estimativa atual de cada grupo, pela ordem da fila e mesas livres. */
  private toDtos(entries: WaitlistEntry[], freeTables: FreeTable[]): WaitlistEntryDto[] {
    let waitingAhead = 0;
    return entries.map((entry, index) => {
      const estimate =
        entry.status === 'waiting'
          ? estimateWaitMinutes(waitingAhead, freeTables.filter(table => table.capacity >= entry.partySize).length)
          : null;
      if (entry.status === 'waiting') waitingAhead += 1;
      return {
        id: entry.id,
        name: entry.name,
        phone: entry.phone,
        partySize: entry.partySize,
        position: index + 1,
        status: entry.status as WaitlistEntryDto['status'],
        joinedAt: entry.joinedAt.toISOString(),
        quotedWaitMinutes: entry.quotedWaitMinutes,
        estimatedWaitMinutes: estimate,
        notifiedAt: entry.notifiedAt?.toISOString() ?? null,
        notifiedTableLabel: entry.notifiedTableLabel,
        byCustomer: entry.customerId !== null,
      };
    });
  }
}
