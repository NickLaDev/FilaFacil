import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DashboardDto } from '@filafacil/shared';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { DashboardService } from './dashboard.service.js';

@ApiTags('Dashboard (gestor)')
@EstablishmentScoped()
@Controller('establishments/:establishmentId/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequireAccess(['dashboard.view'])
  @ApiOperation({ summary: 'Pedidos e faturamento do dia, ticket médio, mesas ocupadas, fila de espera e atrasados (ficha 27)' })
  get(@CurrentEstablishment() establishment: EstablishmentContext): Promise<DashboardDto> {
    return this.dashboard.get(establishment.id);
  }
}
