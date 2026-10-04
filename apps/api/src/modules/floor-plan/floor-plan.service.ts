import { Injectable } from '@nestjs/common';
import { UNLIMITED, type DiningTableDto, type FloorPlanDto } from '@filafacil/shared';
import { conflict, unprocessable } from '../../common/http/app-error.js';
import { lockResource } from '../../database/advisory-lock.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { SaveFloorPlanDto } from './dto/floor-plan.dto.js';
import { qrPrefixFromName, randomQrCode } from './qr-code.js';

const MAX_QR_ATTEMPTS = 50;

/** Nome provisório único (cabe nos 30 caracteres da coluna) usado durante a troca de nomes. */
const temporaryLabel = (tableId: string) => `~${tableId.replace(/-/g, '').slice(0, 28)}`;

const TABLE_SELECT = {
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
} satisfies Prisma.DiningTableSelect;

type TableRow = Prisma.DiningTableGetPayload<{ select: typeof TABLE_SELECT }>;

export const toTableDto = (table: TableRow): DiningTableDto => ({
  id: table.id,
  label: table.label,
  shape: table.shape,
  capacity: table.capacity,
  x: table.positionX,
  y: table.positionY,
  qrCode: table.qrCode,
  occupancy: {
    status: table.occupancy,
    partySize: table.occupiedPartySize ?? 0,
    since: table.occupiedSince?.toISOString() ?? null,
  },
});

/**
 * Ficha 20: planta do salão salva por estabelecimento. A mesma leitura alimenta o mapa do
 * atendente, então uma mesa reposicionada aparece no mesmo lugar sem reconfiguração.
 */
@Injectable()
export class FloorPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async get(establishmentId: string): Promise<FloorPlanDto> {
    const plan = await this.prisma.floorPlan.findUnique({
      where: { establishmentId },
      select: { version: true, updatedAt: true, tables: { orderBy: { createdAt: 'asc' }, select: TABLE_SELECT } },
    });
    return {
      establishmentId,
      version: plan?.version ?? 0,
      tables: plan?.tables.map(toTableDto) ?? [],
      updatedAt: plan?.updatedAt.toISOString() ?? null,
    };
  }

  /**
   * Grava o layout inteiro numa transação: remove mesas tiradas, atualiza as existentes e cria as
   * novas (com QR Code único gerado aqui). A versão impede que um salvamento sobrescreva outro.
   */
  async save(establishment: EstablishmentContext, dto: SaveFloorPlanDto, actorId: string): Promise<FloorPlanDto> {
    const tableLimit = establishment.limits.tables;
    if (tableLimit < UNLIMITED && dto.tables.length > tableLimit) {
      throw unprocessable('TABLE_LIMIT_REACHED', `O plano ${establishment.planName} permite até ${tableLimit} mesas.`);
    }
    const labels = dto.tables.map(table => table.label.toLocaleLowerCase('pt-BR'));
    if (new Set(labels).size !== labels.length) {
      throw unprocessable('DUPLICATE_TABLE_LABEL', 'Cada mesa precisa de um nome diferente.', [{ field: 'tables', message: 'Nome de mesa repetido.' }]);
    }

    await this.prisma.$transaction(async tx => {
      await lockResource(tx, `floor-plan:${establishment.id}`);
      const plan = await tx.floorPlan.findUnique({ where: { establishmentId: establishment.id }, select: { id: true, version: true } });
      if ((plan?.version ?? 0) !== dto.version) {
        throw conflict('FLOOR_PLAN_CONFLICT', 'A planta foi alterada por outra pessoa. Recarregue para ver a versão atual.');
      }
      const planId =
        plan?.id ??
        (await tx.floorPlan.create({ data: { establishmentId: establishment.id, version: 0, updatedById: actorId }, select: { id: true } })).id;

      const existing = new Map(
        (
          await tx.diningTable.findMany({
            where: { floorPlanId: planId },
            select: { id: true, label: true, shape: true, capacity: true, positionX: true, positionY: true },
          })
        ).map(table => [table.id, table]),
      );
      const keptIds = dto.tables.flatMap(table => (table.id ? [table.id] : []));
      if (keptIds.some(id => !existing.has(id))) {
        throw unprocessable('INVALID_TABLE', 'Uma das mesas não pertence a esta planta. Recarregue a página.');
      }

      await tx.diningTable.deleteMany({ where: { floorPlanId: planId, id: { notIn: keptIds } } });
      // Só mesas que mudaram são gravadas; nomes trocados passam por um nome temporário
      // para não esbarrar no índice único (ex.: "Mesa 1" ↔ "Mesa 2" no mesmo salvamento).
      const changed = dto.tables.filter(table => {
        const current = table.id ? existing.get(table.id) : undefined;
        return current && (current.label !== table.label || current.shape !== table.shape || current.capacity !== table.capacity || current.positionX !== table.x || current.positionY !== table.y);
      });
      const relabeled = changed.filter(table => existing.get(table.id as string)?.label !== table.label);
      for (const table of relabeled) await tx.diningTable.update({ where: { id: table.id }, data: { label: temporaryLabel(table.id as string) } });
      for (const table of changed) {
        await tx.diningTable.update({
          where: { id: table.id },
          data: { label: table.label, shape: table.shape, capacity: table.capacity, positionX: table.x, positionY: table.y },
        });
      }

      const newTables = dto.tables.filter(table => !table.id);
      const codes = await this.uniqueQrCodes(tx, qrPrefixFromName(establishment.name), newTables.length);
      await tx.diningTable.createMany({
        data: newTables.map((table, index) => ({
          floorPlanId: planId,
          establishmentId: establishment.id,
          label: table.label,
          shape: table.shape,
          capacity: table.capacity,
          positionX: table.x,
          positionY: table.y,
          qrCode: codes[index] as string,
        })),
      });
      await tx.floorPlan.update({ where: { id: planId }, data: { version: { increment: 1 }, updatedById: actorId } });
    });

    this.realtime.floorPlanUpdated(establishment.id);
    return this.get(establishment.id);
  }

  private async uniqueQrCodes(tx: PrismaTx, prefix: string, count: number) {
    const codes = new Set<string>();
    for (let attempt = 0; codes.size < count && attempt < MAX_QR_ATTEMPTS; attempt++) {
      const candidates = Array.from({ length: (count - codes.size) * 2 }, () => randomQrCode(prefix)).filter(code => !codes.has(code));
      const taken = await tx.diningTable.findMany({ where: { qrCode: { in: candidates } }, select: { qrCode: true } });
      const takenCodes = new Set(taken.map(table => table.qrCode));
      for (const code of candidates) if (!takenCodes.has(code) && codes.size < count) codes.add(code);
    }
    if (codes.size < count) throw conflict('QR_CODE_EXHAUSTED', 'Não foi possível gerar códigos únicos para as mesas. Tente novamente.');
    return [...codes];
  }
}
