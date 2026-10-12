import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CreateReservationDto, MergeTablesDto, OccupyTableDto } from './dto/tables.dto.js';
import { TablesService } from './tables.service.js';

const id = (name: string) => Param(name, ParseUUIDPipe);

@ApiTags('Mapa de mesas')
@EstablishmentScoped()
@Controller('establishments/:establishmentId')
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get('table-map')
  @RequireAccess(['tables.view'], 'floor_plan')
  @ApiOperation({ summary: 'Mesas com estado (livre/ocupada/reservada/chamando), pessoas e grupos mesclados (fichas 16 e 47)' })
  map(@CurrentEstablishment() establishment: EstablishmentContext) {
    return this.tables.map(establishment.id);
  }

  @Post('tables/:tableId/occupy')
  @RequireAccess(['tables.view'], 'floor_plan')
  @ApiOperation({ summary: 'Marca a mesa (ou o grupo) como ocupada com o número de pessoas' })
  @ApiErrors(400, 404)
  occupy(@CurrentEstablishment() establishment: EstablishmentContext, @id('tableId') tableId: string, @Body() dto: OccupyTableDto) {
    return this.tables.occupy(establishment.id, tableId, dto.partySize);
  }

  @Post('tables/:tableId/release')
  @RequireAccess(['tables.view'], 'floor_plan')
  @ApiOperation({ summary: 'Libera a mesa (ou o grupo); avisa o próximo grupo da fila de espera' })
  @ApiErrors(404)
  release(@CurrentEstablishment() establishment: EstablishmentContext, @id('tableId') tableId: string) {
    return this.tables.release(establishment.id, tableId);
  }

  @Post('tables/:tableId/reservations')
  @RequireAccess(['tables.view'], 'floor_plan')
  @ApiOperation({ summary: 'Reserva a mesa' })
  @ApiErrors(400, 404, 409)
  reserve(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @CurrentAuth() auth: AuthContext,
    @id('tableId') tableId: string,
    @Body() dto: CreateReservationDto,
  ) {
    return this.tables.reserve(establishment.id, tableId, dto, auth.userId);
  }

  @Delete('tables/:tableId/reservations/:reservationId')
  @RequireAccess(['tables.view'], 'floor_plan')
  @ApiOperation({ summary: 'Cancela a reserva' })
  @ApiErrors(404)
  cancelReservation(@CurrentEstablishment() establishment: EstablishmentContext, @id('tableId') tableId: string, @id('reservationId') reservationId: string) {
    return this.tables.cancelReservation(establishment.id, tableId, reservationId);
  }

  @Post('tables/:tableId/calls/resolve')
  @RequireAccess(['tables.view'], 'floor_plan')
  @ApiOperation({ summary: 'Marca o chamado de atendimento da mesa como atendido' })
  @ApiErrors(404)
  resolveCalls(@CurrentEstablishment() establishment: EstablishmentContext, @CurrentAuth() auth: AuthContext, @id('tableId') tableId: string) {
    return this.tables.resolveCalls(establishment.id, tableId, auth.userId);
  }

  @Post('table-groups')
  @RequireAccess(['floor.manage'], 'floor_plan')
  @ApiOperation({ summary: 'Mescla duas ou mais mesas numa só unidade (ficha 47)' })
  @ApiErrors(400, 404, 409)
  merge(@CurrentEstablishment() establishment: EstablishmentContext, @CurrentAuth() auth: AuthContext, @Body() dto: MergeTablesDto) {
    return this.tables.merge(establishment.id, dto, auth.userId);
  }

  @Delete('table-groups/:groupId')
  @RequireAccess(['floor.manage'], 'floor_plan')
  @ApiOperation({ summary: 'Desfaz a mescla; as mesas voltam ao estado individual (ficha 47)' })
  @ApiErrors(404)
  unmerge(@CurrentEstablishment() establishment: EstablishmentContext, @id('groupId') groupId: string) {
    return this.tables.unmerge(establishment.id, groupId);
  }

  @Get('table-checks/:tableId')
  @RequireAccess(['tables.view'], 'floor_plan')
  @ApiOperation({ summary: 'Conta consolidada da mesa ou do grupo mesclado (ficha 47)' })
  @ApiErrors(404)
  check(@CurrentEstablishment() establishment: EstablishmentContext, @id('tableId') tableId: string) {
    return this.tables.check(establishment.id, tableId);
  }
}
