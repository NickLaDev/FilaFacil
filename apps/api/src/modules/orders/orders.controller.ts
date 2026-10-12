import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { OrderDto, Page } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CreateOrderDto, CreatePaymentDto } from './dto/orders.dto.js';
import { OrderPaymentsService } from './order-payments.service.js';
import { OrdersService } from './orders.service.js';

/** Limites por usuário (o tracker global usa a sessão): o Pix pendente consulta a cada 4 s (15/min). */
const MINUTE = 60_000;

@ApiTags('Pedidos (cliente)')
@ApiCookieAuth()
@ApiErrors(401)
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: OrderPaymentsService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: MINUTE } })
  @ApiOperation({ summary: 'Confirma o carrinho: o servidor recalcula preços e promoções (fichas 08 e 02)' })
  @ApiErrors(400, 403, 404, 409, 422, 429)
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateOrderDto): Promise<OrderDto> {
    return this.orders.create(auth, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Pedidos da conta, do mais recente ao mais antigo (histórico e comprovantes)' })
  list(@CurrentAuth() auth: AuthContext, @Query() query: PageQueryDto): Promise<Page<OrderDto>> {
    return this.orders.listMine(auth.userId, query);
  }

  @Get(':orderId')
  @ApiOperation({ summary: 'Pedido com itens, status, estimativa, retirada e pagamento (ficha 09)' })
  @ApiErrors(404)
  get(@CurrentAuth() auth: AuthContext, @Param('orderId', ParseUUIDPipe) orderId: string): Promise<OrderDto> {
    return this.orders.getMine(auth.userId, orderId);
  }

  @Post(':orderId/payments')
  @Throttle({ default: { limit: 12, ttl: MINUTE } })
  @ApiOperation({ summary: 'Paga o pedido por Pix ou cartão (ficha 04); exige e-mail ou celular verificado (ficha 65)' })
  @ApiErrors(400, 403, 404, 409, 422, 429, 503)
  pay(@CurrentAuth() auth: AuthContext, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: CreatePaymentDto): Promise<OrderDto> {
    return this.payments.create(auth, orderId, dto);
  }

  @Post(':orderId/payments/sync')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: MINUTE } })
  @ApiOperation({ summary: 'Consulta o gateway e atualiza o pagamento pendente (alternativa ao webhook em desenvolvimento)' })
  @ApiErrors(404, 429)
  sync(@CurrentAuth() auth: AuthContext, @Param('orderId', ParseUUIDPipe) orderId: string): Promise<OrderDto> {
    return this.payments.sync(auth.userId, orderId);
  }

  @Post(':orderId/payments/demo-confirm')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: MINUTE } })
  @ApiOperation({ summary: 'DEMONSTRAÇÃO: o dono do pedido confirma o Pix simulado. Responde 404 se o gateway não for o simulado' })
  @ApiErrors(404, 409, 429)
  demoConfirm(@CurrentAuth() auth: AuthContext, @Param('orderId', ParseUUIDPipe) orderId: string): Promise<OrderDto> {
    return this.payments.simulateConfirm(auth.userId, orderId);
  }
}
