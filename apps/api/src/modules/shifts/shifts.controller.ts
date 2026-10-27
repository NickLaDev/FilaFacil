import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Page, ShiftDto, ShiftHistoryDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ShiftsService } from './shifts.service.js';

@ApiTags('Turno (equipe)')
@EstablishmentScoped()
@Controller('establishments/:establishmentId')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get('shift/current')
  @RequireAccess(['shift.manage', 'orders.manage'])
  @ApiOperation({ summary: 'Turno aberto: `{shift: ShiftDto | null}`' })
  async current(@CurrentEstablishment() establishment: EstablishmentContext): Promise<{ shift: ShiftDto | null }> {
    return { shift: await this.shifts.current(establishment.id) };
  }

  @Post('shift/open')
  @HttpCode(200)
  @RequireAccess(['shift.manage'])
  @ApiOperation({ summary: 'Gestor abre o turno (ficha 25)' })
  @ApiErrors(409)
  open(@CurrentEstablishment() establishment: EstablishmentContext, @CurrentAuth() auth: AuthContext): Promise<ShiftDto> {
    return this.shifts.open(establishment.id, auth.userId);
  }

  @Post('shift/close')
  @HttpCode(200)
  @RequireAccess(['shift.manage'])
  @ApiOperation({ summary: 'Gestor fecha o turno e recebe o histórico com totais' })
  @ApiErrors(409)
  close(@CurrentEstablishment() establishment: EstablishmentContext, @CurrentAuth() auth: AuthContext): Promise<ShiftHistoryDto> {
    return this.shifts.close(establishment.id, auth.userId);
  }

  @Get('shifts')
  @RequireAccess(['shift.manage', 'orders.manage'])
  list(@CurrentEstablishment() establishment: EstablishmentContext, @Query() query: PageQueryDto): Promise<Page<ShiftDto>> {
    return this.shifts.list(establishment.id, query);
  }

  @Get('shifts/:shiftId')
  @RequireAccess(['shift.manage', 'orders.manage'])
  @ApiOperation({ summary: 'Histórico do turno: pedidos entregues e cancelados do período, com totais' })
  @ApiErrors(404)
  history(@CurrentEstablishment() establishment: EstablishmentContext, @Param('shiftId', ParseUUIDPipe) shiftId: string): Promise<ShiftHistoryDto> {
    return this.shifts.history(establishment.id, shiftId);
  }
}
