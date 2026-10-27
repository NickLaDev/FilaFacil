import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CloseTabResponse, TabDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AssignOrderDto, CloseTabDto, TabsQueryDto } from './dto/tabs.dto.js';
import { TabsService } from './tabs.service.js';

const uuid = (name: string) => Param(name, ParseUUIDPipe);

@ApiTags('Comandas (equipe)')
@EstablishmentScoped()
@RequireAccess(['tabs.manage'])
@Controller('establishments/:establishmentId')
export class TabsController {
  constructor(
    private readonly tabs: TabsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('tabs')
  @ApiOperation({ summary: 'Comandas abertas (ou fechadas) com total, pago e saldo (ficha 17)' })
  list(@CurrentEstablishment() establishment: EstablishmentContext, @Query() query: TabsQueryDto): Promise<TabDto[]> {
    return this.tabs.list(establishment.id, query.status);
  }

  @Get('tabs/:tabId')
  @ApiErrors(404)
  get(@CurrentEstablishment() establishment: EstablishmentContext, @uuid('tabId') tabId: string): Promise<TabDto> {
    return this.tabs.get(establishment.id, tabId);
  }

  @Post('tables/:tableId/tab')
  @HttpCode(200)
  @ApiOperation({ summary: 'Abre a comanda da mesa/grupo mesclado, ou devolve a aberta (uma por escopo)' })
  @ApiErrors(404)
  open(@CurrentEstablishment() establishment: EstablishmentContext, @CurrentAuth() auth: AuthContext, @uuid('tableId') tableId: string): Promise<TabDto> {
    return this.tabs.openForTable(establishment.id, tableId, auth.userId);
  }

  @Post('tabs/:tabId/orders')
  @HttpCode(200)
  @ApiOperation({ summary: 'Atribui um pedido da mesa à comanda (pagamento posterior; não vira "pago")' })
  @ApiErrors(404, 409, 422)
  assign(@CurrentEstablishment() establishment: EstablishmentContext, @uuid('tabId') tabId: string, @Body() dto: AssignOrderDto): Promise<TabDto> {
    return this.tabs.assignOrder(establishment.id, tabId, dto.orderId);
  }

  @Delete('tabs/:tabId/orders/:orderId')
  @ApiErrors(404, 409)
  unassign(@CurrentEstablishment() establishment: EstablishmentContext, @uuid('tabId') tabId: string, @uuid('orderId') orderId: string): Promise<TabDto> {
    return this.tabs.unassignOrder(establishment.id, tabId, orderId);
  }

  @Post('tabs/:tabId/refunds/retry')
  @HttpCode(200)
  @ApiOperation({ summary: 'Repete o estorno de cobranças desfeitas com estorno pendente (alerta tab_refund_pending)' })
  @ApiErrors(404)
  async retryRefunds(@CurrentEstablishment() establishment: EstablishmentContext, @uuid('tabId') tabId: string) {
    await this.tabs.get(establishment.id, tabId);
    return this.tabs.retryRefunds(establishment.id, tabId);
  }

  @Post('tabs/:tabId/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fecha a comanda cobrando só o saldo; idempotente (ficha 22)' })
  @ApiErrors(404, 409, 422, 502, 503)
  async close(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @CurrentAuth() auth: AuthContext,
    @uuid('tabId') tabId: string,
    @Body() dto: CloseTabDto,
  ): Promise<CloseTabResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId }, select: { email: true } });
    return this.tabs.close(establishment.id, tabId, dto, { userId: auth.userId, email: user?.email ?? null });
  }
}
