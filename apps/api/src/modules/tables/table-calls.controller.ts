import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CreatedTableCallDto, MyTableCallDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CreateTableCallDto, MyCallQueryDto } from './dto/tables.dto.js';
import { TablesService } from './tables.service.js';

@ApiTags('Chamado de atendimento (cliente)')
@ApiCookieAuth()
@ApiErrors(401)
@Controller('table-calls')
export class TableCallsController {
  constructor(private readonly tables: TablesService) {}

  @Post()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({ summary: 'Chama o atendente na mesa lida pelo QR Code (ficha 16); repetir enquanto aberto devolve o mesmo chamado' })
  @ApiErrors(400, 404, 429)
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateTableCallDto): Promise<CreatedTableCallDto> {
    return this.tables.createCall(auth.userId, dto.tableId);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Chamado aberto do cliente (na mesa informada): `{call}` ou `{call: null}` (ficha 18)' })
  async mine(@CurrentAuth() auth: AuthContext, @Query() query: MyCallQueryDto): Promise<{ call: MyTableCallDto | null }> {
    return { call: await this.tables.myOpenCall(auth.userId, query.tableId) };
  }

  @Get(':callId')
  @ApiOperation({ summary: 'Acompanha o próprio chamado (resolvedAt preenchido = a equipe atendeu)' })
  @ApiErrors(404)
  get(@CurrentAuth() auth: AuthContext, @Param('callId', ParseUUIDPipe) callId: string): Promise<MyTableCallDto> {
    return this.tables.myCall(auth.userId, callId);
  }
}
