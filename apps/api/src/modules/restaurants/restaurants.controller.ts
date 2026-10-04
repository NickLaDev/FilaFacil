import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-docs.js';
import { Public } from '../auth/auth.decorators.js';
import { MenuQueryDto, SearchRestaurantsDto } from './dto/restaurants.dto.js';
import { PublicMenuDto, RestaurantDetailDto, RestaurantPageDto } from './dto/restaurants-responses.dto.js';
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
