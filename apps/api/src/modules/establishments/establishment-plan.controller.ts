import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../database/prisma.service.js';
import { CurrentEstablishment, EstablishmentScoped } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { EstablishmentPlanResponseDto } from './dto/establishment-plan.dto.js';

@ApiTags('Estabelecimento (equipe)')
@EstablishmentScoped()
@Controller('establishments/:establishmentId/plan')
export class EstablishmentPlanController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Plano vigente e recursos liberados (o painel bloqueia seções fora do plano; a API também)' })
  async get(@CurrentEstablishment() establishment: EstablishmentContext): Promise<EstablishmentPlanResponseDto> {
    const { plan } = await this.prisma.establishment.findUniqueOrThrow({
      where: { id: establishment.id },
      select: { plan: { select: { id: true, name: true, maxUnits: true, maxTables: true, maxStaff: true, features: { select: { feature: true } } } } },
    });
    return {
      id: plan.id,
      name: plan.name,
      limits: { units: plan.maxUnits, tables: plan.maxTables, staff: plan.maxStaff },
      features: plan.features.map(grant => grant.feature),
    };
  }
}
