import { Injectable } from '@nestjs/common';
import type { CreateReviewRequest, MyReviewDto, RestaurantReviewsDto, ReviewDto } from '@filafacil/shared';
import { conflict, notFound, unprocessable } from '../../common/http/app-error.js';
import { lockResource } from '../../database/advisory-lock.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';

/** "Maria Silva Souza" → "Maria S."; nunca expõe o nome completo nem outros dados do cliente. */
export const shortName = (name: string) => {
  const [first = 'Cliente', ...rest] = name.trim().split(/\s+/);
  const last = rest[rest.length - 1];
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
};

const toDto = (row: { id: string; rating: number; comment: string; createdAt: Date; user: { name: string; deletedAt: Date | null } }): ReviewDto => ({
  id: row.id,
  rating: row.rating,
  comment: row.comment,
  authorName: row.user.deletedAt ? 'Cliente' : shortName(row.user.name),
  createdAt: row.createdAt.toISOString(),
});

/**
 * Avaliações (ficha 48): uma por pedido entregue, só do dono do pedido. A nota média do restaurante é recalculada
 * na mesma transação (soma ÷ quantidade, sob lock do estabelecimento), então aparece na hora na página.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async create(userId: string, orderId: string, dto: CreateReviewRequest): Promise<MyReviewDto> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId }, select: { id: true, status: true, establishmentId: true } });
    if (!order) throw notFound('Pedido não encontrado.');
    if (order.status !== 'delivered') throw unprocessable('ORDER_NOT_DELIVERED', 'Você pode avaliar o pedido depois de retirá-lo.');

    try {
      const review = await this.prisma.$transaction(async tx => {
        await lockResource(tx, `rating:${order.establishmentId}`);
        const created = await tx.review.create({
          data: { orderId, userId, establishmentId: order.establishmentId, rating: dto.rating, comment: (dto.comment ?? '').trim() },
          include: { user: { select: { name: true, deletedAt: true } } },
        });
        const establishment = await tx.establishment.findUniqueOrThrow({ where: { id: order.establishmentId }, select: { ratingSum: true, ratingCount: true } });
        const sum = establishment.ratingSum + dto.rating;
        const count = establishment.ratingCount + 1;
        await tx.establishment.update({
          where: { id: order.establishmentId },
          data: { ratingSum: sum, ratingCount: count, ratingAverage: new Prisma.Decimal(sum).div(count).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP) },
        });
        return created;
      });
      this.realtime.restaurantUpdated(order.establishmentId);
      this.realtime.orderUpdated(userId, order.establishmentId, orderId);
      return { ...toDto(review), orderId, establishmentId: order.establishmentId };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('ALREADY_REVIEWED', 'Você já avaliou este pedido.');
      throw error;
    }
  }

  async forRestaurant(establishmentId: string, limit = 20): Promise<RestaurantReviewsDto> {
    const establishment = await this.prisma.establishment.findFirst({ where: { id: establishmentId, status: 'active' }, select: { ratingSum: true, ratingCount: true } });
    if (!establishment) throw notFound('Restaurante não encontrado.');
    const [rows, groups] = await Promise.all([
      this.prisma.review.findMany({ where: { establishmentId }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 50), include: { user: { select: { name: true, deletedAt: true } } } }),
      this.prisma.review.groupBy({ by: ['rating'], where: { establishmentId }, _count: { _all: true } }),
    ]);
    const distribution: RestaurantReviewsDto['distribution'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const group of groups) distribution[group.rating as 1 | 2 | 3 | 4 | 5] = group._count._all;
    const average = establishment.ratingCount > 0 ? Math.round((establishment.ratingSum / establishment.ratingCount) * 10) / 10 : 0;
    return { average, count: establishment.ratingCount, distribution, items: rows.map(toDto) };
  }
}
