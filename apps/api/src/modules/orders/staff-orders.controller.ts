import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OrderQueueDto, Page, StaffOrderDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { MarkStationReadyDto, QueueQueryDto, StaffOrdersQueryDto, UpdateEstimateDto, UpdateOrderStatusDto } from './dto/orders.dto.js';
import { OrderPaymentsService } from './order-payments.service.js';
import { OrdersService } from './orders.service.js';

@ApiTags('Pedidos (equipe)')
@EstablishmentScoped()
@Controller('establishments/:establishmentId/orders')
export class StaffOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: OrderPaymentsService,
  ) {}

  @Get()
  @RequireAccess(['orders.manage'])
  @ApiOperation({ summary: 'Pedidos em andamento (pagos e não entregues) ou filtrados por status (ficha 09)' })
  list(@CurrentEstablishment() establishment: EstablishmentContext, @Query() query: StaffOrdersQueryDto): Promise<Page<StaffOrderDto>> {
    return this.orders.listForStaff(establishment.id, query);
  }

  @Get('queue')
  @RequireAccess(['orders.manage'])
  @ApiOperation({ summary: 'Fila FIFO de pedidos (pagos, em preparo, prontos, e os da comanda) com idade e atraso (ficha 23); filtro por estação (24)' })
  queue(@CurrentEstablishment() establishment: EstablishmentContext, @Query() query: QueueQueryDto): Promise<OrderQueueDto> {
    return this.orders.queue(establishment.id, query);
  }

  @Post(':orderId/items/ready')
  @HttpCode(200)
  @RequireAccess(['orders.manage'])
  @ApiOperation({ summary: 'Estação concluiu seus itens; o pedido vira `ready` quando todas terminaram (ficha 24)' })
  @ApiErrors(400, 404, 422)
  markStationReady(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: MarkStationReadyDto,
  ): Promise<StaffOrderDto> {
    return this.orders.markStationReady(establishment.id, orderId, dto.stationId);
  }

  @Patch(':orderId/estimate')
  @RequireAccess(['orders.estimate'])
  @ApiOperation({ summary: 'Gestor ajusta o tempo estimado do pedido, 1–240 min (ficha 63)' })
  @ApiErrors(400, 404, 422)
  adjustEstimate(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @CurrentAuth() auth: AuthContext,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateEstimateDto,
  ): Promise<StaffOrderDto> {
    return this.orders.adjustEstimate(establishment.id, orderId, dto.minutes, auth.userId);
  }

  @Patch(':orderId/status')
  @RequireAccess(['orders.manage'])
  @ApiOperation({ summary: 'Avança o pedido: pago → em preparo → pronto → entregue' })
  @ApiErrors(400, 404, 409, 422)
  updateStatus(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateOrderStatusDto,
  ): Promise<StaffOrderDto> {
    return this.orders.advanceStatus(establishment.id, orderId, dto.status);
  }

  @Post(':orderId/cancel')
  @HttpCode(200)
  @RequireAccess(['orders.manage', 'orders.refund'])
  @ApiOperation({ summary: 'Equipe cancela o pedido: sem cobrança com orders.manage; pago/em preparo exige orders.refund e estorna (ficha 10)' })
  @ApiErrors(403, 404, 409, 502, 503)
  async cancel(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @CurrentAuth() auth: AuthContext,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<StaffOrderDto> {
    await this.payments.cancel({ establishmentId: establishment.id, actorId: auth.userId, canRefund: auth.permissions.has('orders.refund') }, orderId);
    return this.orders.getForStaff(establishment.id, orderId);
  }

  @Post(':orderId/refund')
  @HttpCode(200)
  @RequireAccess(['orders.refund'])
  @ApiOperation({ summary: 'Estorna o pagamento de um pedido pago que ainda não ficou pronto (ficha 04)' })
  @ApiErrors(404, 422, 502, 503)
  async refund(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<StaffOrderDto> {
    await this.payments.refund(establishment.id, orderId);
    return this.orders.getForStaff(establishment.id, orderId);
  }
}
