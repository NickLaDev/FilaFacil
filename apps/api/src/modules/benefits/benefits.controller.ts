import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { CashbackDto, CouponValidationDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { ToNumber } from '../../common/validation/transforms.js';
import { CurrentAuth, Public } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { PrismaService } from '../../database/prisma.service.js';
import { BenefitsService } from './benefits.service.js';
import { ValidateCouponDto } from './dto/benefits.dto.js';

class LimitQueryDto {
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@ApiTags('Cashback e cupons (cliente)')
@ApiCookieAuth()
@ApiErrors(401)
@Controller()
export class BenefitsController {
  constructor(private readonly benefits: BenefitsService) {}

  @Get('me/cashback')
  @ApiOperation({ summary: 'Saldo e extrato de cashback (ficha 15)' })
  cashback(@CurrentAuth() auth: AuthContext, @Query() query: LimitQueryDto): Promise<CashbackDto> {
    return this.benefits.overview(auth.userId, query.limit);
  }

  @Post('coupons/validate')
  @HttpCode(200)
  // Limite próprio: dificulta adivinhar códigos de cupom por tentativa e erro.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Confere um cupom para o carrinho e devolve o desconto (ficha 56); recusa com mensagem clara' })
  @ApiErrors(400, 422)
  validate(@CurrentAuth() auth: AuthContext, @Body() dto: ValidateCouponDto): Promise<CouponValidationDto> {
    return this.benefits.validateCoupon(auth.userId, dto);
  }
}

@ApiTags('Restaurantes (cliente)')
@Public()
@Controller('restaurants/:id/cashback')
export class RestaurantBenefitsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Regras de cashback ativas do restaurante (para o "ganhe X% de volta")' })
  async rules(@Param('id', ParseUUIDPipe) id: string): Promise<{ name: string; percent: number; promotionName: string | null }[]> {
    const now = new Date();
    const rows = await this.prisma.cashbackRule.findMany({
      where: { establishmentId: id, active: true, establishment: { status: 'active' }, OR: [{ promotionId: null }, { promotion: { startsAt: { lte: now }, endsAt: { gte: now } } }] },
      include: { promotion: { select: { name: true } } },
      orderBy: { percent: 'desc' },
    });
    return rows.map(row => ({ name: row.name, percent: row.percent, promotionName: row.promotion?.name ?? null }));
  }
}
