import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  CreateWaitlistEntryDto,
  MoveWaitlistEntryDto,
  ReleaseTablesDto,
  ReleaseTablesResponseDto,
  WaitlistEntryResponseDto,
  WaitlistResponseDto,
} from './dto/waitlist.dto.js';
import { WaitlistService } from './waitlist.service.js';

@ApiTags('Fila de espera (gestor)')
@EstablishmentScoped()
@RequireAccess(['waitlist.manage'], 'waitlist')
@Controller('establishments/:establishmentId')
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Get('waitlist')
  @ApiOperation({ summary: 'Fila atual com posição e estimativa pelas mesas livres (ficha 21)' })
  list(@CurrentEstablishment() establishment: EstablishmentContext): Promise<WaitlistResponseDto> {
    return this.waitlist.list(establishment.id);
  }

  @Post('waitlist')
  @ApiOperation({ summary: 'Adiciona um grupo ao fim da fila' })
  @ApiErrors(400)
  add(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateWaitlistEntryDto,
  ): Promise<WaitlistEntryResponseDto> {
    return this.waitlist.add(establishment.id, dto, auth.userId);
  }

  @Patch('waitlist/:entryId/position')
  @ApiOperation({ summary: 'Reordena manualmente a fila' })
  @ApiErrors(400)
  move(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() dto: MoveWaitlistEntryDto,
  ): Promise<WaitlistResponseDto> {
    return this.waitlist.move(establishment.id, entryId, dto.position);
  }

  @Post('waitlist/:entryId/notify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Avisa (de novo) o grupo de que a mesa está pronta' })
  notify(@CurrentEstablishment() establishment: EstablishmentContext, @Param('entryId', ParseUUIDPipe) entryId: string): Promise<WaitlistEntryResponseDto> {
    return this.waitlist.notify(establishment.id, entryId);
  }

  @Post('waitlist/:entryId/seat')
  @HttpCode(204)
  @ApiOperation({ summary: 'Grupo acomodado: sai da fila (ocupa as mesas do aviso, se houver)' })
  async seat(@CurrentEstablishment() establishment: EstablishmentContext, @Param('entryId', ParseUUIDPipe) entryId: string) {
    await this.waitlist.seat(establishment.id, entryId);
  }

  @Delete('waitlist/:entryId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove o grupo da fila' })
  async remove(@CurrentEstablishment() establishment: EstablishmentContext, @Param('entryId', ParseUUIDPipe) entryId: string) {
    await this.waitlist.remove(establishment.id, entryId);
  }

  @Post('floor-plan/tables/release')
  @HttpCode(200)
  @ApiOperation({ summary: 'Libera mesa(s) e avisa automaticamente o próximo grupo compatível da fila' })
  @ApiErrors(400)
  release(@CurrentEstablishment() establishment: EstablishmentContext, @Body() dto: ReleaseTablesDto): Promise<ReleaseTablesResponseDto> {
    return this.waitlist.releaseTables(establishment.id, dto.tableIds);
  }
}
