import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CreatePromotionDto, PromotionResponseDto, UpdatePromotionDto } from './dto/promotions.dto.js';
import { PromotionsService } from './promotions.service.js';

@ApiTags('Promoções (gestor)')
@EstablishmentScoped()
@RequireAccess(['promotions.manage'], 'promotions')
@Controller('establishments/:establishmentId/promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  @ApiOperation({ summary: 'Promoções com status derivado do período (agendada, ativa, encerrada)' })
  list(@CurrentEstablishment() establishment: EstablishmentContext): Promise<PromotionResponseDto[]> {
    return this.promotions.list(establishment.id);
  }

  @Post()
  @ApiOperation({ summary: 'Cria promoção por período para itens do cardápio (ficha 29)' })
  @ApiErrors(400, 422)
  create(@CurrentEstablishment() establishment: EstablishmentContext, @Body() dto: CreatePromotionDto): Promise<PromotionResponseDto> {
    return this.promotions.create(establishment.id, dto);
  }

  @Patch(':promotionId')
  @ApiOperation({ summary: 'Edita a promoção' })
  @ApiErrors(400, 422)
  update(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @Param('promotionId', ParseUUIDPipe) promotionId: string,
    @Body() dto: UpdatePromotionDto,
  ): Promise<PromotionResponseDto> {
    return this.promotions.update(establishment.id, promotionId, dto);
  }

  @Delete(':promotionId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Exclui a promoção (o preço volta ao normal na hora)' })
  async remove(@CurrentEstablishment() establishment: EstablishmentContext, @Param('promotionId', ParseUUIDPipe) promotionId: string) {
    await this.promotions.remove(establishment.id, promotionId);
  }
}
