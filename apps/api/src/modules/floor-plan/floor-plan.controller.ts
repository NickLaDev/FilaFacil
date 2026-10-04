import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { FloorPlanResponseDto, SaveFloorPlanDto } from './dto/floor-plan.dto.js';
import { FloorPlanService } from './floor-plan.service.js';

@ApiTags('Planta do salão')
@EstablishmentScoped()
@Controller('establishments/:establishmentId/floor-plan')
export class FloorPlanController {
  constructor(private readonly floorPlan: FloorPlanService) {}

  @Get()
  @RequireAccess(['tables.view', 'floor.manage'])
  @ApiOperation({ summary: 'Layout salvo (mesmo dado usado pelo editor do gestor e pelo mapa do atendente)' })
  get(@CurrentEstablishment() establishment: EstablishmentContext): Promise<FloorPlanResponseDto> {
    return this.floorPlan.get(establishment.id);
  }

  @Put()
  @RequireAccess(['floor.manage'], 'floor_plan')
  @ApiOperation({ summary: 'Salva a planta: posição, formato e capacidade das mesas (ficha 20)' })
  @ApiErrors(400, 409, 422)
  save(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @CurrentAuth() auth: AuthContext,
    @Body() dto: SaveFloorPlanDto,
  ): Promise<FloorPlanResponseDto> {
    return this.floorPlan.save(establishment, dto, auth.userId);
  }
}
