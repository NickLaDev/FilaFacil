import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { EXPIRY_ALERT_MAX_DAYS, EXPIRY_ALERT_MIN_DAYS, type ExpirySettingsDto, type IngredientLotDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { Trim } from '../../common/validation/transforms.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { IngredientLotsService } from './ingredient-lots.service.js';

class CreateLotDto {
  @IsUUID()
  ingredientId!: string;

  @Trim()
  @IsString()
  @Length(1, 40)
  code!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(99_999_999)
  quantity?: number | null;

  /** AAAA-MM-DD */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use a data no formato AAAA-MM-DD.' })
  expiresOn!: string;
}

class ExpirySettingsBody {
  @IsInt()
  @Min(EXPIRY_ALERT_MIN_DAYS)
  @Max(EXPIRY_ALERT_MAX_DAYS)
  alertDays!: number;
}

@ApiTags('Validade de insumos (gestor)')
@EstablishmentScoped()
@RequireAccess(['recipes.manage'], 'recipes')
@Controller('establishments/:establishmentId')
export class IngredientLotsController {
  constructor(private readonly lots: IngredientLotsService) {}

  @Get('ingredient-lots')
  @ApiOperation({ summary: 'Lotes por validade (vencidos e a vencer primeiro) com sugestão de pratos (ficha 70)' })
  list(@CurrentEstablishment() establishment: EstablishmentContext): Promise<IngredientLotDto[]> {
    return this.lots.list(establishment.id);
  }

  @Post('ingredient-lots')
  @ApiOperation({ summary: 'Cadastra um lote com data de validade' })
  @ApiErrors(400, 409, 422)
  create(@CurrentEstablishment() establishment: EstablishmentContext, @Body() dto: CreateLotDto): Promise<IngredientLotDto> {
    return this.lots.create(establishment.id, dto);
  }

  @Post('ingredient-lots/:lotId/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marca o lote como usado ou descartado (fecha o alerta)' })
  @ApiErrors(404)
  close(@CurrentEstablishment() establishment: EstablishmentContext, @Param('lotId', ParseUUIDPipe) lotId: string): Promise<IngredientLotDto> {
    return this.lots.close(establishment.id, lotId);
  }

  @Delete('ingredient-lots/:lotId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove um lote cadastrado por engano' })
  @ApiErrors(404)
  async remove(@CurrentEstablishment() establishment: EstablishmentContext, @Param('lotId', ParseUUIDPipe) lotId: string) {
    await this.lots.remove(establishment.id, lotId);
  }

  @Get('expiry-settings')
  @ApiOperation({ summary: 'Antecedência do alerta de validade' })
  settings(@CurrentEstablishment() establishment: EstablishmentContext): Promise<ExpirySettingsDto> {
    return this.lots.settings(establishment.id);
  }

  @Put('expiry-settings')
  @ApiOperation({ summary: 'Define a antecedência do alerta (3 a 30 dias)' })
  @ApiErrors(400, 422)
  updateSettings(@CurrentEstablishment() establishment: EstablishmentContext, @CurrentAuth() auth: AuthContext, @Body() dto: ExpirySettingsBody): Promise<ExpirySettingsDto> {
    return this.lots.updateSettings(establishment.id, dto.alertDays, { userId: auth.userId, name: auth.name });
  }
}
