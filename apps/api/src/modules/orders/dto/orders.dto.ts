import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { MAX_ORDER_LINES, MAX_ORDER_LINE_QUANTITY, ORDER_STATUSES, PAYMENT_METHODS, type OrderStatus, type PaymentMethod } from '@filafacil/shared';
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
