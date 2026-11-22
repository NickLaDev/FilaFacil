import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { CUSTOMER_SEGMENTS, type CustomerSegment } from '@filafacil/shared';
import { Trim } from '../../common/validation/transforms.js';

export class CampaignBodyDto {
  @Trim() @IsString() @Length(3, 60) name!: string;
  @IsIn(CUSTOMER_SEGMENTS) segment!: CustomerSegment;
  /** inactive: dias sem pedir (7–365); frequent: pedidos nos últimos 30 dias (2–100). */
  @IsOptional() @IsInt() @Min(1) @Max(365) threshold?: number;
  @IsIn(['percent', 'fixed']) discountType!: 'percent' | 'fixed';
  /** Percentual (1–100) ou centavos. */
  @IsInt() @Min(1) @Max(10_000_000) discountValue!: number;
  @IsInt() @Min(1) @Max(90) validDays!: number;
  @IsOptional() @Trim() @IsString() @MaxLength(200) message?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateCampaignDto extends PartialType(CampaignBodyDto) {}
