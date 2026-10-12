import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Page, StaffOrderDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { StaffOrdersQueryDto, UpdateOrderStatusDto } from './dto/orders.dto.js';
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
