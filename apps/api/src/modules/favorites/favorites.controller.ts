import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FavoriteIdsDto, FavoritesDto, FavoriteStateDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { FavoritesService } from './favorites.service.js';

@ApiTags('Favoritos')
@ApiCookieAuth()
@ApiErrors(401)
@Controller('me/favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: 'Restaurantes favoritos da conta, do mais recente ao mais antigo (ficha 45)' })
  list(@CurrentAuth() auth: AuthContext): Promise<FavoritesDto> {
    return this.favorites.list(auth.userId);
  }

  @Get('ids')
  @ApiOperation({ summary: 'Só os ids favoritados (para marcar o coração nas listas)' })
  ids(@CurrentAuth() auth: AuthContext): Promise<FavoriteIdsDto> {
    return this.favorites.ids(auth.userId);
  }

  @Put(':restaurantId')
  @ApiOperation({ summary: 'Favorita um restaurante (idempotente)' })
  @ApiErrors(404)
  async add(@CurrentAuth() auth: AuthContext, @Param('restaurantId', ParseUUIDPipe) restaurantId: string): Promise<FavoriteStateDto> {
    await this.favorites.add(auth.userId, restaurantId);
    return { favorited: true };
  }

  @Delete(':restaurantId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove o favorito (idempotente)' })
  async remove(@CurrentAuth() auth: AuthContext, @Param('restaurantId', ParseUUIDPipe) restaurantId: string) {
    await this.favorites.remove(auth.userId, restaurantId);
  }
}
