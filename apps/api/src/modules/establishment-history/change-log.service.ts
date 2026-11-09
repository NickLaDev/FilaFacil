import { Injectable } from '@nestjs/common';
import { ESTABLISHMENT_FIELD_LABELS, type EstablishmentChangeDto, type Page } from '@filafacil/shared';
import { pageArgs, toPage, type PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ChangeActor {
  userId: string;
  name: string;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Só os campos que realmente mudaram (listas e objetos comparados pelo conteúdo). */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, fields: string[]): FieldChange[] {
  return fields.filter(field => !same(before[field], after[field])).map(field => ({ field, oldValue: before[field] ?? null, newValue: after[field] ?? null }));
}

export interface ChangeLogQuery extends PageQueryDto {
  establishmentId?: string;
  field?: string;
  q?: string;
  from?: string;
  to?: string;
}

/**
 * Histórico de alterações do cadastro do estabelecimento (ficha 66). Só insere: não existe rota nem método para
 * editar ou apagar, e o banco rejeita UPDATE/DELETE (trigger). O nome do autor fica gravado junto: o histórico
 * continua legível mesmo se a conta for excluída.
 */
@Injectable()
export class ChangeLogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Grava dentro da transação da própria alteração: se a alteração desfaz, o registro também. */
  async record(client: PrismaTx | PrismaService, establishmentId: string, actor: ChangeActor, changes: FieldChange[]): Promise<void> {
    if (changes.length === 0) return;
    await client.establishmentChange.createMany({
      data: changes.map(change => ({
        establishmentId,
        actorId: actor.userId,
        actorName: actor.name.slice(0, 120),
        field: change.field,
        oldValue: (change.oldValue ?? null) as Prisma.InputJsonValue,
        newValue: (change.newValue ?? null) as Prisma.InputJsonValue,
      })),
    });
  }

  async list(query: ChangeLogQuery): Promise<Page<EstablishmentChangeDto>> {
    const where: Prisma.EstablishmentChangeWhereInput = {
      ...(query.establishmentId && { establishmentId: query.establishmentId }),
      ...(query.field && { field: query.field }),
      ...(query.q && { OR: [{ actorName: { contains: query.q, mode: 'insensitive' } }, { establishment: { name: { contains: query.q, mode: 'insensitive' } } }] }),
      ...((query.from || query.to) && { createdAt: { ...(query.from && { gte: new Date(`${query.from}T00:00:00-03:00`) }), ...(query.to && { lt: new Date(new Date(`${query.to}T00:00:00-03:00`).getTime() + 86_400_000) }) } }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.establishmentChange.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(query), include: { establishment: { select: { name: true } } } }),
      this.prisma.establishmentChange.count({ where }),
    ]);
    return toPage(
      rows.map(row => ({
        id: row.id,
        establishmentId: row.establishmentId,
        establishmentName: row.establishment.name,
        actorName: row.actorName,
        field: row.field,
        fieldLabel: ESTABLISHMENT_FIELD_LABELS[row.field] ?? row.field,
        oldValue: row.oldValue,
        newValue: row.newValue,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }
}
