import { Injectable } from '@nestjs/common';
import type { Page, PublicMenu, RestaurantDetail, RestaurantSummary } from '@filafacil/shared';
import { notFound } from '../../common/http/app-error.js';
import { applyDiscount, bestPromotion } from '../../common/pricing.js';
import { activeRange, hoursLabel, localClock, toOpeningHourDto } from '../../common/time/opening-hours.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { EntitlementsService } from '../access/entitlements.service.js';
import type { MenuQueryDto, SearchRestaurantsDto } from './dto/restaurants.dto.js';

const EARTH_RADIUS_M = 6_371_000;
const KM_PER_DEGREE = 111.32;
const DEFAULT_RADIUS_KM = 30;
/** Teto de candidatos por busca: o filtro por caixa geográfica + índice mantém a consulta barata. */
const MAX_CANDIDATES = 200;

const PUBLIC_INCLUDE = {
  photos: { orderBy: { position: 'asc' }, select: { url: true } },
  openingHours: { select: { weekday: true, opensAt: true, closesAt: true } },
} satisfies Prisma.EstablishmentInclude;

type PublicEstablishment = Prisma.EstablishmentGetPayload<{ include: typeof PUBLIC_INCLUDE }>;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, match => `\\${match}`);

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Ficha 11: estabelecimentos ativos ordenados por distância (Haversine no banco), com filtros. */
  async search(query: SearchRestaurantsDto): Promise<Page<RestaurantSummary>> {
    const now = new Date();
    const hasCoordinates = query.lat !== undefined && query.lng !== undefined;
    const distances = hasCoordinates ? await this.nearbyIds(query) : null;

    const establishments = await this.prisma.establishment.findMany({
      where: {
        status: 'active',
        ...(distances ? { id: { in: [...distances.keys()] } } : {}),
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
        ...(query.category ? { foodCategories: { has: query.category } } : {}),
      },
      include: PUBLIC_INCLUDE,
      ...(distances ? {} : { orderBy: { name: 'asc' }, take: MAX_CANDIDATES }),
    });

    let results = establishments.map(e => this.toSummary(e, now, distances?.get(e.id) ?? null));
    if (query.openNow) results = results.filter(r => r.isOpenNow);
    const sort = query.sort ?? (hasCoordinates ? 'distance' : 'name');
    results.sort((a, b) => {
      if (sort === 'wait') return a.averageWaitMinutes - b.averageWaitMinutes || (a.distanceM ?? 0) - (b.distanceM ?? 0);
      if (sort === 'distance' && a.distanceM !== null && b.distanceM !== null) return a.distanceM - b.distanceM;
      return a.name.localeCompare(b.name, 'pt-BR');
    });

    const start = (query.page - 1) * query.pageSize;
    return { items: results.slice(start, start + query.pageSize), page: query.page, pageSize: query.pageSize, total: results.length };
  }

  /**
   * Pré-filtra por caixa de latitude/longitude (usa o índice) e calcula a distância exata
   * com a fórmula de Haversine. Valores entram como parâmetros (sem SQL injection).
   */
  private async nearbyIds(query: SearchRestaurantsDto) {
    const lat = query.lat as number;
    const lng = query.lng as number;
    const radiusKm = query.radiusKm ?? DEFAULT_RADIUS_KM;
    const deltaLat = radiusKm / KM_PER_DEGREE;
    const deltaLng = radiusKm / (KM_PER_DEGREE * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
    const filters = [
      Prisma.sql`status = 'active'`,
      Prisma.sql`latitude BETWEEN ${lat - deltaLat} AND ${lat + deltaLat}`,
      Prisma.sql`longitude BETWEEN ${lng - deltaLng} AND ${lng + deltaLng}`,
      ...(query.q ? [Prisma.sql`name ILIKE ${`%${escapeLike(query.q)}%`}`] : []),
      ...(query.category ? [Prisma.sql`${query.category} = ANY(food_categories)`] : []),
    ];
    const rows = await this.prisma.$queryRaw<{ id: string; distance_m: number }[]>`
      SELECT id, distance_m FROM (
        SELECT id, ${EARTH_RADIUS_M} * 2 * asin(sqrt(
          power(sin(radians(latitude - ${lat}) / 2), 2) +
          cos(radians(${lat})) * cos(radians(latitude)) * power(sin(radians(longitude - ${lng}) / 2), 2)
        )) AS distance_m
        FROM establishments
        WHERE ${Prisma.join(filters, ' AND ')}
      ) AS nearby
      WHERE distance_m <= ${radiusKm * 1000}
      ORDER BY distance_m
      LIMIT ${MAX_CANDIDATES}`;
    return new Map(rows.map(row => [row.id, Math.round(Number(row.distance_m))]));
  }

  /** Ficha 12: dados públicos do restaurante. Inativo/suspenso responde 404 (some para o cliente). */
  async detail(id: string): Promise<RestaurantDetail> {
    const establishment = await this.prisma.establishment.findFirst({ where: { id, status: 'active' }, include: PUBLIC_INCLUDE });
    if (!establishment) throw notFound('Restaurante não encontrado.');
    return {
      ...this.toSummary(establishment, new Date(), null),
      timezone: establishment.timezone,
      openingHours: [...establishment.openingHours].sort((a, b) => a.weekday - b.weekday || a.opensAt - b.opensAt).map(toOpeningHourDto),
    };
  }

  /**
   * Fichas 03, 19 e 29: só itens disponíveis, com preço vigente calculado aqui. A promoção vale
   * pelo período (sem job) e apenas se o plano do estabelecimento inclui o recurso.
   */
  async menu(id: string, query: MenuQueryDto): Promise<PublicMenu> {
    const establishment = await this.prisma.establishment.findFirst({ where: { id, status: 'active' }, select: { id: true } });
    if (!establishment) throw notFound('Restaurante não encontrado.');

    const now = new Date();
    const promotionsEnabled = (await this.entitlements.featuresFor(id)).has('promotions');
    const items = await this.prisma.menuItem.findMany({
      where: {
        establishmentId: id,
        deletedAt: null,
        available: true,
        ...(query.category ? { category: { name: query.category } } : {}),
        ...(query.q
          ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { description: { contains: query.q, mode: 'insensitive' } }] }
          : {}),
      },
      orderBy: [{ category: { position: 'asc' } }, { position: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        priceCents: true,
        imageUrl: true,
        category: { select: { id: true, name: true } },
        promotionItems: {
          where: { promotion: { startsAt: { lte: now }, endsAt: { gte: now } } },
          select: { promotion: { select: { id: true, name: true, discountPercent: true, endsAt: true } } },
        },
      },
    });

    const categories = new Map<string, { id: string; name: string }>();
    const menuItems = items.map(item => {
      categories.set(item.category.id, item.category);
      const promotion = promotionsEnabled ? bestPromotion(item.promotionItems.map(link => link.promotion)) : null;
      return {
        id: item.id,
        categoryId: item.category.id,
        category: item.category.name,
        name: item.name,
        description: item.description,
        priceCents: item.priceCents,
        finalPriceCents: promotion ? applyDiscount(item.priceCents, promotion.discountPercent) : item.priceCents,
        imageUrl: item.imageUrl,
        promotion: promotion ? { ...promotion, endsAt: promotion.endsAt.toISOString() } : null,
      };
    });
    return { establishmentId: id, categories: [...categories.values()], items: menuItems };
  }

  private toSummary(establishment: PublicEstablishment, now: Date, distanceM: number | null): RestaurantSummary {
    const clock = localClock(now, establishment.timezone);
    const isOpenNow = activeRange(establishment.openingHours, clock) !== null;
    const orderingStatus = !isOpenNow ? 'closed' : establishment.ordersPaused ? 'paused' : establishment.highDemand ? 'busy' : 'open';
    return {
      id: establishment.id,
      name: establishment.name,
      type: establishment.type,
      foodCategories: establishment.foodCategories,
      tags: establishment.tags,
      address: establishment.address,
      city: establishment.city,
      latitude: establishment.latitude,
      longitude: establishment.longitude,
      distanceM,
      rating: establishment.ratingAverage.toNumber(),
      ratingCount: establishment.ratingCount,
      averageWaitMinutes: establishment.averageWaitMinutes,
      orderingStatus,
      acceptingOrders: orderingStatus === 'open' || orderingStatus === 'busy',
      isOpenNow,
      hoursLabel: hoursLabel(establishment.openingHours, clock),
      images: establishment.photos.map(photo => photo.url),
    };
  }
}
