import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { ESTIMATE_MAX_MINUTES, ESTIMATE_MIN_MINUTES, MAX_ORDER_LINES, MAX_ORDER_LINE_QUANTITY, ORDER_STATUSES, PAYMENT_METHODS, type OrderStatus, type PaymentMethod } from '@filafacil/shared';
import { PageQueryDto } from '../../../common/pagination/page-query.dto.js';
import { Trim } from '../../../common/validation/transforms.js';

export class OrderLineDto {
  @IsUUID()
  menuItemId!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_ORDER_LINE_QUANTITY)
  quantity!: number;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  notes?: string;
}

export class CreateOrderDto {
  @IsUUID()
  establishmentId!: string;

  /** Mesa lida no QR Code (opcional). */
  @IsOptional()
  @IsUUID()
  tableId?: string;

  @IsString()
  @Length(8, 64)
  clientRequestId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedTotalCents?: number;

  /** Ficha 14: pontos FilaZero Club a resgatar (múltiplo de 100). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  redeemPoints?: number;

  /** Ficha 15: saldo de cashback a usar, em centavos. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  useCashbackCents?: number;

  /** Ficha 56: código do cupom de desconto. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40)
  couponCode?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ORDER_LINES)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items!: OrderLineDto[];
}

export class CreatePaymentDto {
  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethod;

  /** Token do cartão gerado pelo SDK do Mercado Pago no navegador. */
  @IsOptional()
  @IsString()
  @Length(8, 128)
  cardToken?: string;

  @IsOptional()
  @IsString()
  @Length(2, 40)
  paymentMethodId?: string;

  /** Ficha 49: cartão salvo do próprio usuário (o servidor resolve o token). */
  @IsOptional()
  @IsUUID()
  savedMethodId?: string;

  /** Total que o cliente viu na tela de pagamento. */
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedTotalCents?: number;
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: ORDER_STATUSES })
  @IsIn(ORDER_STATUSES)
  status!: OrderStatus;
}

export class StaffOrdersQueryDto extends PageQueryDto {
  /** Sem filtro: pedidos em andamento (pagos e ainda não entregues). */
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;
}

export class QueueQueryDto {
  /** Filtro de status da fila; `received` = pedidos atribuídos a comanda. */
  @IsOptional()
  @IsIn(['received', 'paid', 'preparing', 'ready'])
  status?: 'received' | 'paid' | 'preparing' | 'ready';

  /** Id da estação ou `general` (itens sem estação). */
  @IsOptional()
  @IsString()
  @Length(1, 36)
  stationId?: string;
}

export class MarkStationReadyDto {
  /** Estação a concluir; null = "Geral" (itens sem estação). */
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  stationId!: string | null;
}

export class UpdateEstimateDto {
  @IsInt()
  @Min(ESTIMATE_MIN_MINUTES)
  @Max(ESTIMATE_MAX_MINUTES)
  minutes!: number;
}
