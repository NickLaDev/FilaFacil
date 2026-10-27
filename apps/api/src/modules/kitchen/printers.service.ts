import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PRINTER_OFFLINE_AFTER_MS, type CreatedPrinterDto, type PrinterDto } from '@filafacil/shared';
import { sha256Hex } from '../../common/crypto/hashing.js';
import { conflict, notFound, unauthorized, unprocessable } from '../../common/http/app-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { AlertsService } from './alerts.service.js';

const MONITOR_INTERVAL_MS = 15_000;

const PRINTER_SELECT = { id: true, name: true, stationId: true, lastSeenAt: true, createdAt: true, station: { select: { name: true } } } satisfies Prisma.PrinterSelect;
type PrinterRow = Prisma.PrinterGetPayload<{ select: typeof PRINTER_SELECT }>;

/** Online = houve sinal há menos de 60 s. Impressora que nunca deu sinal nasce offline (criada agora, tolerância de 60 s). */
export const isOnline = (printer: { lastSeenAt: Date | null; createdAt?: Date }, now: Date) =>
  now.getTime() - (printer.lastSeenAt ?? printer.createdAt ?? new Date(0)).getTime() < PRINTER_OFFLINE_AFTER_MS;

const toDto = (row: PrinterRow, now: Date): PrinterDto => ({
  id: row.id,
  name: row.name,
  stationId: row.stationId,
  stationName: row.station?.name ?? null,
  lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  online: row.lastSeenAt !== null && isOnline(row, now),
});

/**
 * Impressoras da cozinha (ficha 26). O dispositivo manda heartbeat com a própria chave; sem sinal por 60 s a
 * impressora fica offline e um alerta in-app abre para a equipe (uma vez, até voltar). Hardware real não é testado:
 * o painel também simula o heartbeat.
 */
@Injectable()
export class PrintersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrintersService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly alerts: AlertsService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return; // os testes chamam `checkOffline` com relógio injetado
    this.timer = setInterval(() => void this.checkOffline().catch(error => this.logger.warn(`Monitor de impressoras falhou: ${String(error)}`)), MONITOR_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async list(establishmentId: string, now = new Date()): Promise<PrinterDto[]> {
    const rows = await this.prisma.printer.findMany({ where: { establishmentId }, orderBy: { name: 'asc' }, select: PRINTER_SELECT });
    return rows.map(row => toDto(row, now));
  }

  async create(establishmentId: string, dto: { name: string; stationId?: string | null }): Promise<CreatedPrinterDto> {
    await this.assertStation(establishmentId, dto.stationId);
    const deviceKey = `pk_${randomBytes(24).toString('base64url')}`;
    try {
      const row = await this.prisma.printer.create({
        data: { establishmentId, name: dto.name, stationId: dto.stationId ?? null, keyHash: sha256Hex(deviceKey) },
        select: PRINTER_SELECT,
      });
      this.realtime.printersUpdated(establishmentId);
      return { ...toDto(row, new Date()), deviceKey };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('PRINTER_NAME_TAKEN', 'Já existe uma impressora com esse nome.');
      throw error;
    }
  }

  async update(establishmentId: string, printerId: string, dto: { name?: string; stationId?: string | null }): Promise<PrinterDto> {
    await this.find(establishmentId, printerId);
    if (dto.stationId !== undefined) await this.assertStation(establishmentId, dto.stationId);
    try {
      const row = await this.prisma.printer.update({ where: { id: printerId }, data: { name: dto.name, stationId: dto.stationId }, select: PRINTER_SELECT });
      this.realtime.printersUpdated(establishmentId);
      return toDto(row, new Date());
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('PRINTER_NAME_TAKEN', 'Já existe uma impressora com esse nome.');
      throw error;
    }
  }

  async remove(establishmentId: string, printerId: string): Promise<void> {
    await this.find(establishmentId, printerId);
    await this.prisma.printer.delete({ where: { id: printerId } });
    await this.alerts.resolve(establishmentId, 'printer_offline', printerId);
    this.realtime.printersUpdated(establishmentId);
  }

  /** Heartbeat do dispositivo (chave própria, sem sessão). Chave inválida = 401 sem revelar impressoras. */
  async heartbeatByKey(deviceKey: string | undefined, now = new Date()): Promise<void> {
    if (!deviceKey) throw unauthorized('PRINTER_KEY_INVALID', 'Chave da impressora inválida.');
    const printer = await this.prisma.printer.findFirst({ where: { keyHash: sha256Hex(deviceKey) }, select: { id: true, establishmentId: true } });
    if (!printer) throw unauthorized('PRINTER_KEY_INVALID', 'Chave da impressora inválida.');
    await this.beat(printer.establishmentId, printer.id, now);
  }

  /** Heartbeat simulado pelo painel (demonstração: não há hardware). */
  async heartbeatSimulated(establishmentId: string, printerId: string, now = new Date()): Promise<PrinterDto> {
    await this.find(establishmentId, printerId);
    await this.beat(establishmentId, printerId, now);
    return (await this.list(establishmentId, now)).find(printer => printer.id === printerId) as PrinterDto;
  }

  private async beat(establishmentId: string, printerId: string, now: Date) {
    const before = await this.prisma.printer.findUnique({ where: { id: printerId }, select: { lastSeenAt: true, createdAt: true } });
    await this.prisma.printer.update({ where: { id: printerId }, data: { lastSeenAt: now } });
    const wasOffline = !before || before.lastSeenAt === null || !isOnline(before, now);
    const resolved = await this.alerts.resolve(establishmentId, 'printer_offline', printerId);
    if (wasOffline || resolved) this.realtime.printersUpdated(establishmentId);
  }

  /**
   * Varre as impressoras: sem sinal há mais de 60 s → abre alerta in-app (uma vez) e avisa em tempo real.
   * Impressora que nunca deu sinal só é considerada offline depois de 60 s da criação. Devolve quantos alertas abriu.
   */
  async checkOffline(now = new Date()): Promise<number> {
    const printers = await this.prisma.printer.findMany({ select: { id: true, name: true, establishmentId: true, lastSeenAt: true, createdAt: true } });
    let opened = 0;
    for (const printer of printers) {
      if (isOnline(printer, now)) continue;
      const created = await this.alerts.open(printer.establishmentId, 'printer_offline', printer.id, `Impressora "${printer.name}" está offline (sem sinal há mais de 60 s).`);
      if (created) {
        opened++;
        this.realtime.printersUpdated(printer.establishmentId);
      }
    }
    return opened;
  }

  private async find(establishmentId: string, printerId: string) {
    const printer = await this.prisma.printer.findFirst({ where: { id: printerId, establishmentId }, select: { id: true } });
    if (!printer) throw notFound('Impressora não encontrada.');
  }

  private async assertStation(establishmentId: string, stationId: string | null | undefined) {
    if (!stationId) return;
    const station = await this.prisma.kitchenStation.findFirst({ where: { id: stationId, establishmentId }, select: { id: true } });
    if (!station) throw unprocessable('INVALID_STATION', 'Estação não encontrada neste estabelecimento.', [{ field: 'stationId', message: 'Estação inválida.' }]);
  }
}
