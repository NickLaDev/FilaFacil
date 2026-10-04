import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNumber, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import { INGREDIENT_UNITS, type IngredientDto, type IngredientUnit, type TechnicalSheetDto, type TechnicalSheetLineDto } from '@filafacil/shared';
import { Trim } from '../../../common/validation/transforms.js';

export class CreateIngredientDto {
  @Trim()
  @IsString()
  @Length(1, 60)
  name!: string;

  @ApiProperty({ enum: INGREDIENT_UNITS })
  @IsIn(INGREDIENT_UNITS)
  unit!: IngredientUnit;

  /** Custo por unidade de medida em reais (até 4 casas, ex.: 0.0134 por ml). */
  @IsNumber({ maxDecimalPlaces: 4, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(99_999_999)
  unitCost!: number;
}

export class UpdateIngredientDto extends PartialType(CreateIngredientDto) {}

export class SheetLineInputDto {
  @IsUUID()
  ingredientId!: string;

  /** Quantidade na unidade do insumo (até 4 casas). */
  @IsNumber({ maxDecimalPlaces: 4, allowNaN: false, allowInfinity: false })
  @Min(0.0001)
  @Max(99_999)
  quantity!: number;
}

export class UpsertTechnicalSheetDto {
  /** Custo máximo aceito, em % do preço de venda (alerta quando ultrapassado). */
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(100)
  costLimitPercent!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SheetLineInputDto)
  lines!: SheetLineInputDto[];
}

export class IngredientResponseDto implements IngredientDto {
  id!: string;
  name!: string;
  @ApiProperty({ enum: INGREDIENT_UNITS })
  unit!: IngredientUnit;
  @ApiProperty({ example: '9.3300' })
  unitCost!: string;
  /** Em quantas fichas o insumo aparece. */
  usedInSheets!: number;
}

export class TechnicalSheetLineResponseDto implements TechnicalSheetLineDto {
  ingredientId!: string;
  ingredientName!: string;
  @ApiProperty({ enum: INGREDIENT_UNITS })
  unit!: IngredientUnit;
  quantity!: string;
  unitCost!: string;
  lineCost!: string;
}

export class TechnicalSheetResponseDto implements TechnicalSheetDto {
  id!: string;
  menuItemId!: string;
  menuItemName!: string;
  priceCents!: number;
  costLimitPercent!: number;
  @ApiProperty({ type: [TechnicalSheetLineResponseDto] })
  lines!: TechnicalSheetLineResponseDto[];
  /** Calculado pelo servidor com o custo atual dos insumos. */
  @ApiProperty({ example: '9.9000' })
  totalCost!: string;
  costPercent!: number;
  overLimit!: boolean;
  updatedAt!: string;
}
