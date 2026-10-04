import { Injectable } from '@nestjs/common';
import { PLAN_FEATURE_LABELS, STAFF_ROLES, type PlanFeature } from '@filafacil/shared';
import { forbidden } from '../../common/http/app-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { EstablishmentContext, EstablishmentRequirement } from './access.types.js';

/**
 * Ponto único das regras de acesso por estabelecimento: vínculo da equipe, status do
 * estabelecimento, permissões do usuário e recursos do plano (lidos do banco a cada requisição,
 * então trocar o plano vale na hora, sem deploy).
 */
@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async featuresFor(establishmentId: string): Promise<Set<PlanFeature>> {
    const grants = await this.prisma.planFeatureGrant.findMany({
      where: { plan: { establishments: { some: { id: establishmentId } } } },
      select: { feature: true },
    });
    return new Set(grants.map(grant => grant.feature));
  }

  /** Carrega e valida o contexto da equipe; lança 403 com o motivo exato quando negado. */
  async authorize(auth: AuthContext, establishmentId: string, requirement: EstablishmentRequirement): Promise<EstablishmentContext> {
    const membership = await this.prisma.establishmentMembership.findUnique({
      where: { userId_establishmentId: { userId: auth.userId, establishmentId } },
      select: {
        establishment: {
          select: {
            id: true,
            name: true,
            status: true,
            plan: { select: { name: true, maxTables: true, features: { select: { feature: true } } } },
          },
        },
      },
    });
    if (!membership || !STAFF_ROLES.includes(auth.role)) {
      throw forbidden('ESTABLISHMENT_ACCESS_DENIED', 'Você não tem acesso a este estabelecimento.');
    }
    const { establishment } = membership;
    const context: EstablishmentContext = {
      id: establishment.id,
      name: establishment.name,
      status: establishment.status,
      planName: establishment.plan.name,
      features: new Set(establishment.plan.features.map(grant => grant.feature)),
      limits: { tables: establishment.plan.maxTables },
    };
    assertRequirement(auth, context, requirement);
    return context;
  }
}

export function assertRequirement(auth: AuthContext, context: EstablishmentContext, requirement: EstablishmentRequirement) {
  if (context.status === 'suspended') {
    throw forbidden('ESTABLISHMENT_SUSPENDED', 'Este estabelecimento está suspenso na plataforma.');
  }
  if (requirement.anyPermission.length && !requirement.anyPermission.some(permission => auth.permissions.has(permission))) {
    throw forbidden('MISSING_PERMISSION', 'Seu usuário não tem permissão para esta ação.');
  }
  if (requirement.feature && !context.features.has(requirement.feature)) {
    throw forbidden('FEATURE_NOT_IN_PLAN', `${PLAN_FEATURE_LABELS[requirement.feature]} não está incluído no plano ${context.planName}.`);
  }
}
