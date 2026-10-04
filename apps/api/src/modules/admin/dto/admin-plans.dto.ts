import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsIn, IsInt, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
import { PLAN_FEATURES, UNLIMITED, type PlanFeature } from '@filafacil/shared';
import { Trim } from '../../../common/validation/transforms.js';

export class PlanLimitsInputDto {
  /** Use 999 para ilimitado. */
  @IsInt()
  @Min(1)
  @Max(UNLIMITED)
  units!: number;

  @IsInt()
  @Min(1)
  @Max(UNLIMITED)
  tables!: number;

  @IsInt()
  @Min(1)
  @Max(UNLIMITED)
  staff!: number;
}

export class CreatePlanDto {
  @Trim()
  @IsString()
  @Length(1, 40)
  name!: string;

  /** Preço mensal em centavos. */
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  monthlyPriceCents!: number;

  @ValidateNested()
  @Type(() => PlanLimitsInputDto)
  limits!: PlanLimitsInputDto;

  @ApiProperty({ enum: PLAN_FEATURES, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(PLAN_FEATURES, { each: true })
  features!: PlanFeature[];
}

export class UpdatePlanDto extends PartialType(CreatePlanDto) {}
