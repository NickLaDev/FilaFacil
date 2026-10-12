import { Body, Controller, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CreatedTableCallDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CreateTableCallDto } from './dto/tables.dto.js';
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
}
