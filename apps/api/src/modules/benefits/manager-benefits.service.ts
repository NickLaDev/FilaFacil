import { Injectable } from '@nestjs/common';
import type { CashbackRuleDto, CouponDto } from '@filafacil/shared';
import { normalizeCouponCode } from '@filafacil/shared';
import { conflict, notFound, unprocessable } from '../../common/http/app-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { expiredHoldWhere } from '../../common/unpaid-hold.js';
import { toCouponDto } from './benefits.service.js';
import type { CashbackRuleDto as CashbackRuleBody, CouponBodyDto, UpdateCashbackRuleDto, UpdateCouponDto } from './dto/benefits.dto.js';

const toRuleDto = (rule: { id: string; name: string; percent: number; promotionId: string | null; active: boolean; createdAt: Date; promotion: { name: string } | null }): CashbackRuleDto => ({
  id: rule.id,
  name: rule.name,
  percent: rule.percent,
  promotionId: rule.promotionId,
  promotionName: rule.promotion?.name ?? null,
  active: rule.active,
  createdAt: rule.createdAt.toISOString(),
});

/** Gestão de regras de cashback (ficha 15) e cupons (ficha 56) do estabelecimento. */
@Injectable()
export class ManagerBenefitsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Cashback ─────────────────────────────────────────────────────────────

  async listRules(establishmentId: string): Promise<CashbackRuleDto[]> {
    const rows = await this.prisma.cashbackRule.findMany({ where: { establishmentId }, include: { promotion: { select: { name: true } } }, orderBy: { createdAt: 'desc' } });
    return rows.map(toRuleDto);
  }

  async createRule(establishmentId: string, dto: CashbackRuleBody): Promise<CashbackRuleDto> {
    await this.assertPromotion(establishmentId, dto.promotionId);
    const row = await this.prisma.cashbackRule.create({
      data: { establishmentId, name: dto.name, percent: dto.percent, promotionId: dto.promotionId ?? null, active: dto.active ?? true },
      include: { promotion: { select: { name: true } } },
    });
    return toRuleDto(row);
  }

  async updateRule(establishmentId: string, id: string, dto: UpdateCashbackRuleDto): Promise<CashbackRuleDto> {
    const current = await this.prisma.cashbackRule.findFirst({ where: { id, establishmentId }, select: { id: true } });
    if (!current) throw notFound('Regra de cashback não encontrada.');
    await this.assertPromotion(establishmentId, dto.promotionId);
    const row = await this.prisma.cashbackRule.update({
      where: { id },
      data: { name: dto.name, percent: dto.percent, promotionId: dto.promotionId, active: dto.active },
      include: { promotion: { select: { name: true } } },
    });
    return toRuleDto(row);
  }

  /** Pedidos já criados mantêm o cashback congelado na criação: apagar a regra não os afeta. */
  async removeRule(establishmentId: string, id: string): Promise<void> {
    const { count } = await this.prisma.cashbackRule.deleteMany({ where: { id, establishmentId } });
    if (count === 0) throw notFound('Regra de cashback não encontrada.');
  }

  private async assertPromotion(establishmentId: string, promotionId: string | null | undefined) {
    if (!promotionId) return;
    const found = await this.prisma.promotion.findFirst({ where: { id: promotionId, establishmentId }, select: { id: true } });
    if (!found) throw unprocessable('INVALID_PROMOTION', 'Promoção não encontrada neste estabelecimento.', [{ field: 'promotionId', message: 'Promoção inválida.' }]);
  }

  // ─── Cupons ───────────────────────────────────────────────────────────────

  async listCoupons(establishmentId: string): Promise<CouponDto[]> {
    const now = new Date();
    const rows = await this.prisma.coupon.findMany({ where: { establishmentId }, orderBy: { createdAt: 'desc' } });
    const counts = await this.prisma.couponRedemption.groupBy({ by: ['couponId'], where: { coupon: { establishmentId }, order: { NOT: expiredHoldWhere() } }, _count: { _all: true } });
    const used = new Map(counts.map(row => [row.couponId, row._count._all]));
    return rows.map(row => toCouponDto(row, used.get(row.id) ?? 0, now));
  }

  async createCoupon(establishmentId: string, dto: CouponBodyDto): Promise<CouponDto> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.assertValid(dto.discountType, dto.discountValue, startsAt, endsAt);
    try {
      const row = await this.prisma.coupon.create({
        data: {
          establishmentId,
          code: normalizeCouponCode(dto.code),
          description: dto.description ?? '',
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          minOrderCents: dto.minOrderCents ?? 0,
          startsAt,
          endsAt,
          maxUses: dto.maxUses ?? null,
          active: dto.active ?? true,
        },
      });
      return toCouponDto(row, 0);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('COUPON_CODE_TAKEN', 'Já existe um cupom com este código neste estabelecimento.');
      throw error;
    }
  }

  async updateCoupon(establishmentId: string, id: string, dto: UpdateCouponDto): Promise<CouponDto> {
    const current = await this.prisma.coupon.findFirst({ where: { id, establishmentId } });
    if (!current) throw notFound('Cupom não encontrado.');
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : current.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : current.endsAt;
    this.assertValid(dto.discountType ?? current.discountType, dto.discountValue ?? current.discountValue, startsAt, endsAt);
    const row = await this.prisma.coupon.update({
      where: { id },
      data: {
        description: dto.description,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        minOrderCents: dto.minOrderCents,
        startsAt: dto.startsAt ? startsAt : undefined,
        endsAt: dto.endsAt ? endsAt : undefined,
        maxUses: dto.maxUses,
        active: dto.active,
      },
    });
    const used = await this.prisma.couponRedemption.count({ where: { couponId: id, order: { NOT: expiredHoldWhere() } } });
    return toCouponDto(row, used);
  }

  /** Cupom já usado não é apagado (o pedido guarda o código): desative-o. */
  async removeCoupon(establishmentId: string, id: string): Promise<void> {
    const coupon = await this.prisma.coupon.findFirst({ where: { id, establishmentId }, select: { id: true, _count: { select: { redemptions: true } } } });
    if (!coupon) throw notFound('Cupom não encontrado.');
    if (coupon._count.redemptions > 0) throw conflict('COUPON_IN_USE', 'Este cupom já foi usado. Desative-o em vez de excluir.');
    await this.prisma.coupon.delete({ where: { id } });
  }

  private assertValid(type: 'percent' | 'fixed', value: number, startsAt: Date, endsAt: Date) {
    if (endsAt <= startsAt) throw unprocessable('INVALID_PERIOD', 'A validade deve terminar depois do início.', [{ field: 'endsAt', message: 'Data final deve ser posterior à inicial.' }]);
    if (type === 'percent' && value > 100) throw unprocessable('INVALID_DISCOUNT', 'O percentual deve ficar entre 1 e 100.', [{ field: 'discountValue', message: 'Máximo 100%.' }]);
  }
}
