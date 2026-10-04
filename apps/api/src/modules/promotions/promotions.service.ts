import { Injectable } from '@nestjs/common';
import type { PromotionDto } from '@filafacil/shared';
import { notFound, unprocessable } from '../../common/http/app-error.js';
import { promotionState } from '../../common/pricing.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { CreatePromotionDto, UpdatePromotionDto } from './dto/promotions.dto.js';

const PROMOTION_INCLUDE = { items: { select: { menuItemId: true } } } satisfies Prisma.PromotionInclude;
type PromotionRow = Prisma.PromotionGetPayload<{ include: typeof PROMOTION_INCLUDE }>;

const toDto = (promotion: PromotionRow, now: Date): PromotionDto => ({
  id: promotion.id,
  name: promotion.name,
  discountPercent: promotion.discountPercent,
  startsAt: promotion.startsAt.toISOString(),
  endsAt: promotion.endsAt.toISOString(),
  itemIds: promotion.items.map(item => item.menuItemId),
  state: promotionState(promotion.startsAt, promotion.endsAt, now),
});

/**
 * Ficha 29. O preço original do item nunca muda: o desconto é aplicado na leitura do cardápio
 * enquanto `starts_at <= agora <= ends_at` — por isso a promoção começa e termina sozinha.
 */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(establishmentId: string): Promise<PromotionDto[]> {
    const promotions = await this.prisma.promotion.findMany({
      where: { establishmentId },
      orderBy: { startsAt: 'desc' },
      include: PROMOTION_INCLUDE,
    });
    const now = new Date();
    return promotions.map(promotion => toDto(promotion, now));
  }

  async create(establishmentId: string, dto: CreatePromotionDto): Promise<PromotionDto> {
    const period = this.validPeriod(dto.startsAt, dto.endsAt);
    await this.assertItemsBelong(establishmentId, dto.itemIds);
    const promotion = await this.prisma.promotion.create({
      data: {
        establishmentId,
        name: dto.name,
        discountPercent: dto.discountPercent,
        ...period,
        items: { create: dto.itemIds.map(menuItemId => ({ menuItemId })) },
      },
      include: PROMOTION_INCLUDE,
    });
    this.realtime.menuUpdated(establishmentId);
    return toDto(promotion, new Date());
  }

  async update(establishmentId: string, promotionId: string, dto: UpdatePromotionDto): Promise<PromotionDto> {
    const current = await this.prisma.promotion.findFirst({ where: { id: promotionId, establishmentId } });
    if (!current) throw notFound('Promoção não encontrada.');
    const period = this.validPeriod(dto.startsAt ?? current.startsAt.toISOString(), dto.endsAt ?? current.endsAt.toISOString());
    if (dto.itemIds) await this.assertItemsBelong(establishmentId, dto.itemIds);

    const promotion = await this.prisma.$transaction(async tx => {
      if (dto.itemIds) await tx.promotionItem.deleteMany({ where: { promotionId } });
      return tx.promotion.update({
        where: { id: promotionId },
        data: {
          name: dto.name,
          discountPercent: dto.discountPercent,
          ...period,
          ...(dto.itemIds && { items: { create: dto.itemIds.map(menuItemId => ({ menuItemId })) } }),
        },
        include: PROMOTION_INCLUDE,
      });
    });
    this.realtime.menuUpdated(establishmentId);
    return toDto(promotion, new Date());
  }

  async remove(establishmentId: string, promotionId: string) {
    const { count } = await this.prisma.promotion.deleteMany({ where: { id: promotionId, establishmentId } });
    if (count === 0) throw notFound('Promoção não encontrada.');
    this.realtime.menuUpdated(establishmentId);
  }

  private validPeriod(startsAt: string, endsAt: string) {
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (end <= start) {
      throw unprocessable('INVALID_PERIOD', 'O fim da promoção deve ser depois do início.', [{ field: 'endsAt', message: 'Fim deve ser depois do início.' }]);
    }
    return { startsAt: start, endsAt: end };
  }

  /** Só itens ativos do próprio estabelecimento entram na promoção. */
  private async assertItemsBelong(establishmentId: string, itemIds: string[]) {
    const count = await this.prisma.menuItem.count({ where: { id: { in: itemIds }, establishmentId, deletedAt: null } });
    if (count !== itemIds.length) {
      throw unprocessable('INVALID_ITEMS', 'Selecione apenas itens do cardápio deste estabelecimento.', [{ field: 'itemIds', message: 'Item inválido.' }]);
    }
  }
}
