import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUrl, Length, Max, MaxLength, Min } from 'class-validator';
import { Trim } from '../../../common/validation/transforms.js';

export const MAX_PRICE_CENTS = 1_000_000;

export class CreateMenuItemDto {
  @Trim()
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  description?: string;

  /** Categoria existente ou nova (criada automaticamente, ex.: "Sobremesas"). */
  @Trim()
  @IsString()
  @Length(1, 40)
  categoryName!: string;

  /** Preço em centavos (R$ 28,90 → 2890). */
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE_CENTS)
  priceCents!: number;

  /** Link https de uma foto já hospedada. Para enviar arquivo, use PUT …/photo. */
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  available?: boolean;
}

export class UpdateMenuItemDto extends PartialType(CreateMenuItemDto) {}

export class SetAvailabilityDto {
  @IsBoolean()
  available!: boolean;
}

export class SetHighlightDto {
  @IsBoolean()
  highlighted!: boolean;
}
