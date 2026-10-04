import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import {
  CreateIngredientDto,
  IngredientResponseDto,
  TechnicalSheetResponseDto,
  UpdateIngredientDto,
  UpsertTechnicalSheetDto,
} from './dto/technical-sheets.dto.js';
import { TechnicalSheetsService } from './technical-sheets.service.js';

@ApiTags('Fichas técnicas (gestor)')
@EstablishmentScoped()
@RequireAccess(['recipes.manage'], 'recipes')
@Controller('establishments/:establishmentId')
export class TechnicalSheetsController {
  constructor(private readonly sheets: TechnicalSheetsService) {}

  @Get('ingredients')
  @ApiOperation({ summary: 'Insumos com custo unitário' })
  listIngredients(@CurrentEstablishment() establishment: EstablishmentContext): Promise<IngredientResponseDto[]> {
    return this.sheets.listIngredients(establishment.id);
  }

  @Post('ingredients')
  @ApiOperation({ summary: 'Cadastra um insumo' })
  @ApiErrors(400, 409)
  createIngredient(@CurrentEstablishment() establishment: EstablishmentContext, @Body() dto: CreateIngredientDto): Promise<IngredientResponseDto> {
    return this.sheets.createIngredient(establishment.id, dto);
  }

  @Patch('ingredients/:ingredientId')
  @ApiOperation({ summary: 'Edita um insumo; o custo de todas as fichas que o usam é recalculado' })
  @ApiErrors(400, 409)
  updateIngredient(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @Param('ingredientId', ParseUUIDPipe) ingredientId: string,
    @Body() dto: UpdateIngredientDto,
  ): Promise<IngredientResponseDto> {
    return this.sheets.updateIngredient(establishment.id, ingredientId, dto);
  }

  @Delete('ingredients/:ingredientId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Exclui um insumo (sai das fichas que o usavam)' })
  async deleteIngredient(@CurrentEstablishment() establishment: EstablishmentContext, @Param('ingredientId', ParseUUIDPipe) ingredientId: string) {
    await this.sheets.deleteIngredient(establishment.id, ingredientId);
  }

  @Get('technical-sheets')
  @ApiOperation({ summary: 'Fichas técnicas com custo, % do preço e alerta de limite (calculados no servidor)' })
  listSheets(@CurrentEstablishment() establishment: EstablishmentContext): Promise<TechnicalSheetResponseDto[]> {
    return this.sheets.listSheets(establishment.id);
  }

  @Put('technical-sheets/:menuItemId')
  @ApiOperation({ summary: 'Cria ou substitui a ficha técnica de um item (ficha 31)' })
  @ApiErrors(400, 422)
  upsertSheet(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @Param('menuItemId', ParseUUIDPipe) menuItemId: string,
    @Body() dto: UpsertTechnicalSheetDto,
  ): Promise<TechnicalSheetResponseDto> {
    return this.sheets.upsertSheet(establishment.id, menuItemId, dto);
  }

  @Delete('technical-sheets/:menuItemId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a ficha técnica do item' })
  async deleteSheet(@CurrentEstablishment() establishment: EstablishmentContext, @Param('menuItemId', ParseUUIDPipe) menuItemId: string) {
    await this.sheets.deleteSheet(establishment.id, menuItemId);
  }
}
