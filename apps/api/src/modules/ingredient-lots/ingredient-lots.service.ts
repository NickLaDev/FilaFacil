import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EXPIRY_ALERT_MAX_DAYS, EXPIRY_ALERT_MIN_DAYS, type ExpirySettingsDto, type IngredientLotDto, type IngredientLotInput } from '@filafacil/shared';
import { conflict, notFound, unprocessable } from '../../common/http/app-error.js';
import { localDate } from '../../common/time/day-bounds.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ChangeLogService } from '../establishment-history/change-log.service.js';
import { InboxService } from '../inbox/inbox.service.js';
import { AlertsService } from '../kitchen/alerts.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const MONITOR_INTERVAL_MS = 10 * 60_000;
const DAY_MS = 86_400_000;

const LOT_INCLUDE = {
  ingredient: { select: { id: true, name: true, unit: true, sheetItems: { select: { technicalSheet: { select: { menuItem: { select: { id: true, name: true, deletedAt: true } } } } } } } },
} satisfies Prisma.IngredientLotInclude;
type LotRow = Prisma.IngredientLotGetPayload<{ include: typeof LOT_INCLUDE }>;

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** Dias entre hoje (calendário da casa) e a validade; negativo = vencido. */
export const daysUntil = (expiresOn: Date, today: string) => Math.round((Date.UTC(expiresOn.getUTCFullYear(), expiresOn.getUTCMonth(), expiresOn.getUTCDate()) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);

const dishesOf = (lot: LotRow) =>
  lot.ingredient.sheetItems
    .map(item => item.technicalSheet.menuItem)
    .filter(item => item.deletedAt === null)
    .map(item => ({ id: item.id, name: item.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

const stateOf = (lot: { closedAt: Date | null }, daysLeft: number, alertDays: number): IngredientLotDto['state'] =>
  lot.closedAt ? 'closed' : daysLeft < 0 ? 'expired' : daysLeft <= alertDays ? 'expiring' : 'ok';

const toDto = (lot: LotRow, today: string, alertDays: number): IngredientLotDto => {
  const daysLeft = daysUntil(lot.expiresOn, today);
  return {
    id: lot.id,
    ingredientId: lot.ingredientId,
    ingredientName: lot.ingredient.name,
    unit: lot.ingredient.unit,
    code: lot.code,
    quantity: lot.quantity?.toFixed(4) ?? null,
    expiresOn: isoDay(lot.expiresOn),
    daysLeft,
    state: stateOf(lot, daysLeft, alertDays),
    closedAt: lot.closedAt?.toISOString() ?? null,
    dishes: dishesOf(lot),
  };
};

const when = (days: number) => (days < 0 ? `venceu há ${-days} ${-days === 1 ? 'dia' : 'dias'}` : days === 0 ? 'vence hoje' : days === 1 ? 'vence amanhã' : `vence em ${days} dias`);

/**
 * Validade por lote de insumo (ficha 70). Um monitor periódico (e cada cadastro/baixa de lote) confere os lotes
 * abertos: dentro da antecedência configurada (padrão 7 dias; mínimo 3) abre UM alerta por lote — no painel e como
 * aviso à equipe — com a sugestão dos pratos que usam o insumo. Lote usado/descartado fecha o alerta.
 */
@Injectable()
export class IngredientLotsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngredientLotsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly inbox: InboxService,
    private readonly realtime: RealtimeService,
    private readonly changeLog: ChangeLogService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return; // os testes chamam `syncAll` com relógio injetado
    this.timer = setInterval(() => void this.syncAll().catch(error => this.logger.warn(`Monitor de validade falhou: ${String(error)}`)), MONITOR_INTERVAL_MS);
    this.timer.unref();
    void this.syncAll().catch(error => this.logger.warn(`Monitor de validade falhou: ${String(error)}`));
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async context(establishmentId: string) {
    return this.prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { timezone: true, expiryAlertDays: true } });
  }

  async list(establishmentId: string, now = new Date()): Promise<IngredientLotDto[]> {
    const { timezone, expiryAlertDays } = await this.context(establishmentId);
    const today = localDate(now, timezone);
    const rows = await this.prisma.ingredientLot.findMany({ where: { ingredient: { establishmentId } }, include: LOT_INCLUDE, orderBy: [{ expiresOn: 'asc' }, { code: 'asc' }] });
    const lots = rows.map(row => toDto(row, today, expiryAlertDays));
    // Abertos primeiro (vencidos e a vencer no topo), encerrados no fim.
    return [...lots.filter(lot => lot.state !== 'closed'), ...lots.filter(lot => lot.state === 'closed')];
  }

  async create(establishmentId: string, input: IngredientLotInput, now = new Date()): Promise<IngredientLotDto> {
    const ingredient = await this.prisma.ingredient.findFirst({ where: { id: input.ingredientId, establishmentId }, select: { id: true } });
    if (!ingredient) throw unprocessable('INVALID_INGREDIENT', 'Insumo não encontrado neste estabelecimento.', [{ field: 'ingredientId', message: 'Insumo inválido.' }]);
    const expiresOn = new Date(`${input.expiresOn}T00:00:00Z`);
    if (Number.isNaN(expiresOn.getTime()) || isoDay(expiresOn) !== input.expiresOn) throw unprocessable('INVALID_DATE', 'Data de validade inválida.', [{ field: 'expiresOn', message: 'Use AAAA-MM-DD.' }]);
    try {
      const lot = await this.prisma.ingredientLot.create({
        data: { ingredientId: ingredient.id, code: input.code, quantity: input.quantity === null || input.quantity === undefined ? null : new Prisma.Decimal(String(input.quantity)), expiresOn },
        include: LOT_INCLUDE,
      });
      await this.sync(establishmentId, now);
      const { timezone, expiryAlertDays } = await this.context(establishmentId);
      return toDto(lot, localDate(now, timezone), expiryAlertDays);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('LOT_EXISTS', 'Já existe um lote com este código para o insumo.');
      throw error;
    }
  }

  /** Lote consumido ou descartado: sai do monitoramento e o alerta fecha. */
  async close(establishmentId: string, lotId: string, now = new Date()): Promise<IngredientLotDto> {
    await this.find(establishmentId, lotId);
    await this.prisma.ingredientLot.updateMany({ where: { id: lotId, closedAt: null }, data: { closedAt: now } });
    await this.sync(establishmentId, now);
    return this.get(establishmentId, lotId, now);
  }

  async remove(establishmentId: string, lotId: string, now = new Date()): Promise<void> {
    await this.find(establishmentId, lotId);
    await this.prisma.ingredientLot.delete({ where: { id: lotId } });
    await this.sync(establishmentId, now);
  }

  async settings(establishmentId: string): Promise<ExpirySettingsDto> {
    return { alertDays: (await this.context(establishmentId)).expiryAlertDays };
  }

  async updateSettings(establishmentId: string, alertDays: number, actor: { userId: string; name: string }, now = new Date()): Promise<ExpirySettingsDto> {
    if (alertDays < EXPIRY_ALERT_MIN_DAYS || alertDays > EXPIRY_ALERT_MAX_DAYS) {
      throw unprocessable('INVALID_ALERT_DAYS', `A antecedência deve ficar entre ${EXPIRY_ALERT_MIN_DAYS} e ${EXPIRY_ALERT_MAX_DAYS} dias.`);
    }
    await this.prisma.$transaction(async tx => {
      const before = await tx.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { expiryAlertDays: true } });
      await tx.establishment.update({ where: { id: establishmentId }, data: { expiryAlertDays: alertDays } });
      if (before.expiryAlertDays !== alertDays) await this.changeLog.record(tx, establishmentId, actor, [{ field: 'expiryAlertDays', oldValue: before.expiryAlertDays, newValue: alertDays }]);
    });
    await this.sync(establishmentId, now);
    return { alertDays };
  }

  private async find(establishmentId: string, lotId: string) {
    const lot = await this.prisma.ingredientLot.findFirst({ where: { id: lotId, ingredient: { establishmentId } }, select: { id: true } });
    if (!lot) throw notFound('Lote não encontrado.');
    return lot;
  }

  private async get(establishmentId: string, lotId: string, now: Date) {
    const { timezone, expiryAlertDays } = await this.context(establishmentId);
    const row = await this.prisma.ingredientLot.findUniqueOrThrow({ where: { id: lotId }, include: LOT_INCLUDE });
    return toDto(row, localDate(now, timezone), expiryAlertDays);
  }

  /** Confere todos os estabelecimentos com lotes em aberto (monitor periódico). */
  async syncAll(now = new Date()): Promise<void> {
    const open = await this.prisma.ingredientLot.findMany({ where: { closedAt: null }, select: { ingredient: { select: { establishmentId: true } } }, distinct: ['ingredientId'] });
    const ids = new Set(open.map(lot => lot.ingredient.establishmentId));
    // Alertas abertos de estabelecimentos que já não têm lotes abertos também precisam fechar.
    const stale = await this.prisma.staffAlert.findMany({ where: { kind: 'ingredient_expiring', resolvedAt: null }, select: { establishmentId: true }, distinct: ['establishmentId'] });
    for (const row of stale) ids.add(row.establishmentId);
    for (const id of ids) await this.sync(id, now);
  }

  /**
   * Abre/atualiza o alerta de cada lote aberto dentro da antecedência e fecha o dos demais. Um alerta aberto por lote
   * (índice parcial em staff_alerts) e um aviso à equipe por lote (chave de deduplicação).
   */
  async sync(establishmentId: string, now = new Date()): Promise<void> {
    const { timezone, expiryAlertDays } = await this.context(establishmentId);
    const today = localDate(now, timezone);
    const lots = await this.prisma.ingredientLot.findMany({ where: { ingredient: { establishmentId } }, include: LOT_INCLUDE });
    const openAlerts = await this.prisma.staffAlert.findMany({ where: { establishmentId, kind: 'ingredient_expiring', resolvedAt: null }, select: { refId: true } });
    const alerting = new Set<string>();
    for (const lot of lots) {
      const daysLeft = daysUntil(lot.expiresOn, today);
      if (lot.closedAt || daysLeft > expiryAlertDays) continue;
      alerting.add(lot.id);
      const dishes = dishesOf(lot).slice(0, 3).map(dish => dish.name);
      const message = `Lote ${lot.code} de ${lot.ingredient.name} ${when(daysLeft)} (${isoDay(lot.expiresOn).split('-').reverse().join('/')}).${dishes.length ? ` Priorize: ${dishes.join(', ')}.` : ''}`;
      await this.prisma.staffAlert.updateMany({ where: { establishmentId, kind: 'ingredient_expiring', refId: lot.id, resolvedAt: null }, data: { message: message.slice(0, 200) } });
      await this.alerts.open(establishmentId, 'ingredient_expiring', lot.id, message);
      await this.inbox.notifyEstablishment(establishmentId, {
        kind: 'ingredient_expiring',
        title: daysLeft < 0 ? `Lote vencido: ${lot.ingredient.name}` : `Ingrediente perto do vencimento: ${lot.ingredient.name}`,
        body: message,
        refId: lot.id,
        dedupeKey: `lot_expiring:${lot.id}`,
        requiredPermission: 'recipes.manage',
      });
    }
    for (const alert of openAlerts) if (!alerting.has(alert.refId)) await this.alerts.resolve(establishmentId, 'ingredient_expiring', alert.refId);
    this.realtime.stockUpdated(establishmentId);
  }
}
