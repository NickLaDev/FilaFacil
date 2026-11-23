import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { MyOfferDto, SegmentCampaignDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CampaignBodyDto, UpdateCampaignDto } from './campaigns.dto.js';
import { CampaignsService } from './campaigns.service.js';

@ApiTags('Promoções (equipe)')
@EstablishmentScoped()
@RequireAccess(['promotions.manage'], 'promotions')
@Controller('establishments/:establishmentId/campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @ApiOperation({ summary: 'Campanhas segmentadas (ficha 68) com envios, usos, taxa de uso e prévia do segmento hoje' })
  list(@CurrentEstablishment() establishment: EstablishmentContext): Promise<SegmentCampaignDto[]> {
    return this.campaigns.list(establishment.id);
  }

  @Post()
  @ApiOperation({ summary: 'Cria a campanha; quem já está no segmento hoje recebe o cupom na hora, os demais automaticamente' })
  @ApiErrors(400, 422)
  create(@CurrentEstablishment() establishment: EstablishmentContext, @Body() dto: CampaignBodyDto): Promise<SegmentCampaignDto> {
    return this.campaigns.create(establishment.id, dto);
  }

  @Patch(':id')
  @ApiErrors(400, 404, 422)
  update(@CurrentEstablishment() establishment: EstablishmentContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCampaignDto): Promise<SegmentCampaignDto> {
    return this.campaigns.update(establishment.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiErrors(404, 409)
  async remove(@CurrentEstablishment() establishment: EstablishmentContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.campaigns.remove(establishment.id, id);
  }
}

@ApiTags('Conta')
@Controller('me/offers')
export class MyOffersController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @ApiOperation({ summary: 'Cupons pessoais recebidos em campanhas (aniversário, volta, cliente frequente)' })
  mine(@CurrentAuth() auth: AuthContext): Promise<MyOfferDto[]> {
    return this.campaigns.myOffers(auth.userId);
  }
}
