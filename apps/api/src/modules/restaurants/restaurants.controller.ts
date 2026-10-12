import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiErrors } from '../../common/http/api-docs.js';
import { Public } from '../auth/auth.decorators.js';
import { MenuQueryDto, SearchRestaurantsDto } from './dto/restaurants.dto.js';
import { RestaurantCategoriesResponseDto, PublicMenuDto, QrResolveResponseDto, RestaurantDetailDto, RestaurantPageDto } from './dto/restaurants-responses.dto.js';
import { RestaurantsService } from './restaurants.service.js';

@ApiTags('Restaurantes (cliente)')
@Public()
@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Get()
  @ApiOperation({ summary: 'Busca restaurantes próximos com filtros (ficha 11)' })
  @ApiErrors(400)
  search(@Query() query: SearchRestaurantsDto): Promise<RestaurantPageDto> {
    return this.restaurants.search(query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Categorias de comida disponíveis para filtrar a busca (ficha 60)' })
  categories(): Promise<RestaurantCategoriesResponseDto> {
    return this.restaurants.categories();
  }

  @Get('qr/:code')
  // Pública e por IP: vários clientes escaneando no mesmo Wi-Fi do bar não podem se bloquear.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @ApiOperation({ summary: 'Resolve o código de um QR Code de mesa em estabelecimento e mesa (ficha 02)' })
  @ApiErrors(404, 429)
  resolveQr(@Param('code') code: string): Promise<QrResolveResponseDto> {
    return this.restaurants.resolveQr(code);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Página do restaurante: fotos, nota, endereço e horário (ficha 12)' })
  @ApiErrors(404)
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<RestaurantDetailDto> {
    return this.restaurants.detail(id);
  }

  @Get(':id/menu')
  @ApiOperation({ summary: 'Cardápio disponível com preço vigente, busca e filtro (fichas 03, 19, 29)' })
  @ApiErrors(400, 404)
  menu(@Param('id', ParseUUIDPipe) id: string, @Query() query: MenuQueryDto): Promise<PublicMenuDto> {
    return this.restaurants.menu(id, query);
  }
}
