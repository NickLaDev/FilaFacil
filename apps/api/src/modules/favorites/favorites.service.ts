import { Injectable } from '@nestjs/common';
import type { FavoriteIdsDto, FavoritesDto } from '@filafacil/shared';
import { notFound } from '../../common/http/app-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RestaurantsService } from '../restaurants/restaurants.service.js';

const MAX_FAVORITES = 200;

/** Ficha 45: favoritos presos à conta (valem em qualquer aparelho). Restaurante inativo some da lista, mas o favorito é mantido. */
@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restaurants: RestaurantsService,
  ) {}

  private async orderedIds(userId: string) {
    const rows = await this.prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: MAX_FAVORITES,
      select: { establishmentId: true },
    });
    return rows.map(row => row.establishmentId);
  }

  async list(userId: string): Promise<FavoritesDto> {
    return { items: await this.restaurants.summariesByIds(await this.orderedIds(userId)) };
  }

  async ids(userId: string): Promise<FavoriteIdsDto> {
    return { ids: await this.orderedIds(userId) };
  }

  async add(userId: string, establishmentId: string) {
    const exists = await this.prisma.establishment.findFirst({ where: { id: establishmentId, status: 'active' }, select: { id: true } });
    if (!exists) throw notFound('Restaurante não encontrado.');
    await this.prisma.favorite.upsert({
      where: { userId_establishmentId: { userId, establishmentId } },
      create: { userId, establishmentId },
      update: {},
    });
  }

  async remove(userId: string, establishmentId: string) {
    await this.prisma.favorite.deleteMany({ where: { userId, establishmentId } });
  }
}
