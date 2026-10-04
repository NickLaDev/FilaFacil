import { ApiProperty, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsISO8601, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { PromotionDto, PromotionState } from '@filafacil/shared';
import { Trim } from '../../../common/validation/transforms.js';

export class CreatePromotionDto {
  @Trim()
  @IsString()
  @Length(1, 60)
  name!: string;

  /** Percentual de desconto (1 a 90). */
  @IsInt()
  @Min(1)
  @Max(90)
  discountPercent!: number;

  /** Início em ISO 8601 com fuso (ex.: 2026-10-04T18:00:00-03:00). Guardado em UTC. */
  @IsISO8601({ strict: true })
  startsAt!: string;

  @IsISO8601({ strict: true })
  endsAt!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  itemIds!: string[];
}

export class UpdatePromotionDto extends PartialType(CreatePromotionDto) {}

export class PromotionResponseDto implements PromotionDto {
  id!: string;
  name!: string;
  discountPercent!: number;
  startsAt!: string;
  endsAt!: string;
  itemIds!: string[];
  /** Derivado do período no momento da consulta. */
  @ApiProperty({ enum: ['scheduled', 'active', 'expired'] })
  state!: PromotionState;
}
