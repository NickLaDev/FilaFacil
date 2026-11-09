import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsISO8601, IsIn, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { CASHBACK_MAX_PERCENT, COUPON_CODE_PATTERN } from '@filafacil/shared';
import { Trim } from '../../../common/validation/transforms.js';

export class ValidateCouponDto {
  @IsUUID()
  establishmentId!: string;

  @Trim()
  @IsString()
  @Length(1, 40)
  code!: string;

  @IsInt()
  @Min(0)
  @Max(100_000_000)
  subtotalCents!: number;
}

export class CashbackRuleDto {
  @Trim()
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(CASHBACK_MAX_PERCENT)
  percent!: number;

  /** Vazio = vale para todo o pedido; preenchido = só itens da promoção, enquanto ela estiver vigente. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  promotionId?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateCashbackRuleDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CASHBACK_MAX_PERCENT)
  percent?: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  promotionId?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CouponBodyDto {
  /** Letras, números, hífen e sublinhado (3 a 32); sempre guardado em maiúsculas. */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(COUPON_CODE_PATTERN, { message: 'Use de 3 a 32 letras, números, hífen ou sublinhado.' })
  code!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  description?: string;

  @IsIn(['percent', 'fixed'])
  discountType!: 'percent' | 'fixed';

  /** Percentual (1–100) ou centavos, conforme o tipo. */
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  discountValue!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  minOrderCents?: number;

  @IsISO8601({ strict: true })
  startsAt!: string;

  @IsISO8601({ strict: true })
  endsAt!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxUses?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateCouponDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  description?: string;

  @IsOptional()
  @IsIn(['percent', 'fixed'])
  discountType?: 'percent' | 'fixed';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  discountValue?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  minOrderCents?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxUses?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
