import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PAYMENT_METHODS, type PaymentMethod } from '@filafacil/shared';

export class AssignOrderDto {
  @IsUUID()
  orderId!: string;
}

export class CloseTabDto {
  /** Chave de idempotência da tentativa de fechamento. */
  @IsString()
  @Length(8, 64)
  idempotencyKey!: string;

  @ApiProperty({ enum: PAYMENT_METHODS, required: false })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  @Length(8, 128)
  cardToken?: string;

  @IsOptional()
  @IsString()
  @Length(2, 40)
  paymentMethodId?: string;
}

export class TabsQueryDto {
  @IsOptional()
  @IsIn(['open', 'closed'])
  status?: 'open' | 'closed';
}
