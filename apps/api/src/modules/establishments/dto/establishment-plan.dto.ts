import { ApiProperty } from '@nestjs/swagger';
import { PLAN_FEATURES, type EstablishmentPlanDto, type PlanFeature, type PlanLimits } from '@filafacil/shared';

export class PlanLimitsDto implements PlanLimits {
  units!: number;
  tables!: number;
  staff!: number;
}

export class EstablishmentPlanResponseDto implements EstablishmentPlanDto {
  id!: string;
  name!: string;
  @ApiProperty({ type: PlanLimitsDto })
  limits!: PlanLimitsDto;
  @ApiProperty({ enum: PLAN_FEATURES, isArray: true })
  features!: PlanFeature[];
}
