import { Injectable } from '@nestjs/common';
import { UNLIMITED, type DiningTableDto, type FloorPlanDto, type LayoutDuplicationTargetDto } from '@filafacil/shared';
import { conflict, forbidden, unprocessable } from '../../common/http/app-error.js';
import { lockResource } from '../../database/advisory-lock.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { EntitlementsService } from '../access/entitlements.service.js';
import type { EstablishmentContext } from '../access/access.types.js';
import type { AuthContext } from '../auth/auth.types.js';
import { dissolveSmallGroups } from '../tables/table-state.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { DuplicateFloorPlanDto, SaveFloorPlanDto } from './dto/floor-plan.dto.js';
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
    private readonly entitlements: EntitlementsService,
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
      await dissolveSmallGroups(tx, establishment.id);
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

  /** Ficha 61: unidades da mesma organização em que o usuário trabalha, com a razão quando não dá para copiar. */
  async duplicateTargets(sourceId: string, userId: string): Promise<LayoutDuplicationTargetDto[]> {
    const source = await this.prisma.establishment.findUniqueOrThrow({ where: { id: sourceId }, select: { organizationId: true } });
    const memberships = await this.prisma.establishmentMembership.findMany({
      where: { userId, establishmentId: { not: sourceId }, establishment: { organizationId: source.organizationId } },
      select: {
        establishment: {
          select: {
            id: true,
            name: true,
            status: true,
            plan: { select: { name: true, features: { select: { feature: true } } } },
            floorPlan: { select: { _count: { select: { tables: true } } } },
          },
        },
      },
    });
    return memberships
      .map(({ establishment: e }): LayoutDuplicationTargetDto => {
        const reason =
          e.status === 'suspended'
            ? 'Estabelecimento suspenso.'
            : !e.plan.features.some(grant => grant.feature === 'layout_duplication')
              ? `O plano ${e.plan.name} não inclui duplicar layout.`
              : null;
        return { id: e.id, name: e.name, tableCount: e.floorPlan?._count.tables ?? 0, eligible: reason === null, reason };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  /**
   * Copia mesas (nome, formato, capacidade e posição) para outra unidade da mesma organização.
   * Tudo numa transação com lock das duas plantas: ou o destino recebe o layout inteiro ou nada muda.
   * A origem só é lida. Os QR Codes do destino são novos (cada mesa física tem o seu).
   */
  async duplicate(source: EstablishmentContext, auth: AuthContext, dto: DuplicateFloorPlanDto): Promise<FloorPlanDto> {
    if (dto.targetEstablishmentId === source.id) {
      throw unprocessable('SAME_ESTABLISHMENT', 'Escolha outra unidade como destino.');
    }
    // Vínculo do usuário com o destino, permissão e recurso do plano do destino.
    const target = await this.entitlements.authorize(auth, dto.targetEstablishmentId, { anyPermission: ['floor.manage'], feature: 'layout_duplication' });
    if (!target.features.has('floor_plan')) throw forbidden('FEATURE_NOT_IN_PLAN', `A planta do salão não está incluída no plano ${target.planName}.`);
    const organizations = await this.prisma.establishment.findMany({
      where: { id: { in: [source.id, target.id] } },
      select: { id: true, organizationId: true },
    });
    if (new Set(organizations.map(item => item.organizationId)).size !== 1 || organizations.length !== 2) {
      throw forbidden('DIFFERENT_ORGANIZATION', 'O destino precisa ser da mesma organização.');
    }

    await this.prisma.$transaction(async tx => {
      for (const id of [source.id, target.id].sort()) await lockResource(tx, `floor-plan:${id}`);
      const sourceTables = await tx.diningTable.findMany({
        where: { establishmentId: source.id },
        orderBy: { createdAt: 'asc' },
        select: { label: true, shape: true, capacity: true, positionX: true, positionY: true },
      });
      if (!sourceTables.length) throw unprocessable('SOURCE_LAYOUT_EMPTY', 'A unidade de origem não tem mesas para copiar.');
      const tableLimit = target.limits.tables;
      if (tableLimit < UNLIMITED && sourceTables.length > tableLimit) {
        throw unprocessable('TABLE_LIMIT_REACHED', `O plano ${target.planName} permite até ${tableLimit} mesas.`);
      }

      const plan = await tx.floorPlan.upsert({
        where: { establishmentId: target.id },
        create: { establishmentId: target.id, version: 0, updatedById: auth.userId },
        update: {},
        select: { id: true },
      });
      const existing = await tx.diningTable.count({ where: { floorPlanId: plan.id } });
      if (existing > 0 && !dto.replace) {
        throw conflict('TARGET_LAYOUT_NOT_EMPTY', 'A unidade de destino já tem mesas. Confirme a substituição para continuar.');
      }
      if (existing > 0) {
        // Substituir apaga mesas e invalida QR Codes impressos: só com o destino parado.
        const busy =
          (await tx.diningTable.count({ where: { floorPlanId: plan.id, OR: [{ occupancy: 'occupied' }, { groupId: { not: null } }, { calls: { some: { resolvedAt: null } } }, { reservations: { some: { closedAt: null } } }, { orders: { some: { status: { in: ['received', 'paid', 'preparing', 'ready'] } } } }] } })) > 0;
        if (busy) {
          throw conflict('TARGET_IN_USE', 'O destino tem mesa ocupada, chamado, reserva, mesa mesclada ou pedido em andamento. Libere antes de substituir.');
        }
        await tx.diningTable.deleteMany({ where: { floorPlanId: plan.id } });
        await tx.tableGroup.deleteMany({ where: { establishmentId: target.id } });
      }
      const codes = await this.uniqueQrCodes(tx, qrPrefixFromName(target.name), sourceTables.length);
      await tx.diningTable.createMany({
        data: sourceTables.map((table, index) => ({
          floorPlanId: plan.id,
          establishmentId: target.id,
          label: table.label,
          shape: table.shape,
          capacity: table.capacity,
          positionX: table.positionX,
          positionY: table.positionY,
          qrCode: codes[index] as string,
        })),
      });
      await tx.floorPlan.update({ where: { id: plan.id }, data: { version: { increment: 1 }, updatedById: auth.userId } });
    });
    this.realtime.floorPlanUpdated(target.id);
    return this.get(target.id);
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
