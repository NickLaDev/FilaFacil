import { Body, Controller, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import type { IngredientDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { StockService } from './stock.service.js';

const MAX_QUANTITY = 99_999_999;

class UpdateStockDto {
  /** null remove o controle de estoque do insumo. */
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_QUANTITY)
  stockQuantity!: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_QUANTITY)
  minStockQuantity?: number;
}

@ApiTags('Estoque (gestor)')
@EstablishmentScoped()
@Controller('establishments/:establishmentId/ingredients')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Put(':ingredientId/stock')
  @RequireAccess(['stock.manage'], 'recipes')
  @ApiOperation({ summary: 'Define estoque atual e mínimo do insumo (ficha 50); estoque ≤ mínimo abre alerta' })
  @ApiErrors(400, 404)
  update(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @CurrentAuth() auth: AuthContext,
    @Param('ingredientId', ParseUUIDPipe) ingredientId: string,
    @Body() dto: UpdateStockDto,
  ): Promise<IngredientDto> {
    return this.stock.update(establishment.id, ingredientId, dto, auth.userId);
  }
}
