import { Injectable } from '@nestjs/common';
import type { PlanDto } from '@filafacil/shared';
import { conflict, notFound } from '../../common/http/app-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { CreatePlanDto, UpdatePlanDto } from './dto/admin-plans.dto.js';

const PLAN_INCLUDE = {
  features: { select: { feature: true } },
  _count: { select: { establishments: true } },
} satisfies Prisma.PlanInclude;

type PlanRow = Prisma.PlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

const toPlanDto = (plan: PlanRow): PlanDto => ({
  id: plan.id,
  name: plan.name,
  monthlyPriceCents: plan.monthlyPriceCents,
  limits: { units: plan.maxUnits, tables: plan.maxTables, staff: plan.maxStaff },
  features: plan.features.map(grant => grant.feature),
  establishmentCount: plan._count.establishments,
});

const nameTaken = () => conflict('PLAN_NAME_TAKEN', 'Já existe um plano com esse nome.', [{ field: 'name', message: 'Nome em uso.' }]);

/**
 * Ficha 37: planos e seus recursos. As features ficam no banco e são a fonte única dos
 * entitlements — alterar um plano muda o acesso de todos os estabelecimentos nele, sem deploy.
 */
@Injectable()
export class AdminPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(): Promise<PlanDto[]> {
    const plans = await this.prisma.plan.findMany({ include: PLAN_INCLUDE, orderBy: { monthlyPriceCents: 'asc' } });
    return plans.map(toPlanDto);
  }

  async create(dto: CreatePlanDto): Promise<PlanDto> {
    try {
      const plan = await this.prisma.plan.create({
        data: {
          name: dto.name,
          monthlyPriceCents: dto.monthlyPriceCents,
          maxUnits: dto.limits.units,
          maxTables: dto.limits.tables,
          maxStaff: dto.limits.staff,
          features: { create: dto.features.map(feature => ({ feature })) },
        },
        include: PLAN_INCLUDE,
      });
      return toPlanDto(plan);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw nameTaken();
      throw error;
    }
  }

  async update(id: string, dto: UpdatePlanDto): Promise<PlanDto> {
    if (!(await this.prisma.plan.count({ where: { id } }))) throw notFound('Plano não encontrado.');
    try {
      const plan = await this.prisma.$transaction(async tx => {
        if (dto.features) {
          await tx.planFeatureGrant.deleteMany({ where: { planId: id } });
          await tx.planFeatureGrant.createMany({ data: dto.features.map(feature => ({ planId: id, feature })) });
        }
        return tx.plan.update({
          where: { id },
          data: {
            name: dto.name,
            monthlyPriceCents: dto.monthlyPriceCents,
            ...(dto.limits && { maxUnits: dto.limits.units, maxTables: dto.limits.tables, maxStaff: dto.limits.staff }),
          },
          include: { ...PLAN_INCLUDE, establishments: { select: { id: true } } },
        });
      });
      for (const establishment of plan.establishments) this.realtime.establishmentUpdated(establishment.id);
      return toPlanDto(plan);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw nameTaken();
      throw error;
    }
  }

  /** Plano em uso não pode ser excluído: os estabelecimentos precisam migrar antes. */
  async remove(id: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id }, include: { _count: { select: { establishments: true } } } });
    if (!plan) throw notFound('Plano não encontrado.');
    if (plan._count.establishments > 0) throw conflict('PLAN_IN_USE', 'Migre os estabelecimentos para outro plano antes de excluir.');
    await this.prisma.plan.delete({ where: { id } });
  }
}
