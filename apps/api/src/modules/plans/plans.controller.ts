import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import type { PlanChangeResultDto, PlanComparisonDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { PlanChangeService } from './plan-change.service.js';

export class ChangePlanDto {
  @IsUUID()
  planId!: string;
}

@ApiTags('Estabelecimento (equipe)')
@EstablishmentScoped()
@Controller('establishments/:establishmentId/plan')
export class PlansController {
  constructor(private readonly plans: PlanChangeService) {}

  @Get('options')
  @RequireAccess(['plan.manage', 'billing.view'])
  @ApiOperation({ summary: 'Comparativo de planos (ficha 69): recursos lado a lado, plano atual e valor proporcional da troca hoje' })
  options(@CurrentEstablishment() establishment: EstablishmentContext): Promise<PlanComparisonDto> {
    return this.plans.compare(establishment.id);
  }

  @Post('change')
  @RequireAccess(['plan.manage'])
  @ApiOperation({ summary: 'Upgrade/downgrade self-service (ficha 58): recursos na hora, cobrança ou crédito proporcional, confirmação por e-mail' })
  @ApiErrors(404, 409, 422)
  change(@CurrentEstablishment() establishment: EstablishmentContext, @Body() dto: ChangePlanDto, @CurrentAuth() auth: AuthContext): Promise<PlanChangeResultDto> {
    return this.plans.change(establishment.id, dto.planId, auth);
  }
}
