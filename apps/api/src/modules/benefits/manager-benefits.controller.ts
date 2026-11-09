import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CashbackRuleDto as CashbackRuleResponse, CouponDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CashbackRuleDto, CouponBodyDto, UpdateCashbackRuleDto, UpdateCouponDto } from './dto/benefits.dto.js';
import { ManagerBenefitsService } from './manager-benefits.service.js';

@ApiTags('Cashback e cupons (gestor)')
@EstablishmentScoped()
@RequireAccess(['promotions.manage'], 'promotions')
@Controller('establishments/:establishmentId')
export class ManagerBenefitsController {
  constructor(private readonly service: ManagerBenefitsService) {}

  @Get('cashback-rules')
  @ApiOperation({ summary: 'Regras de cashback do estabelecimento (ficha 15)' })
  listRules(@CurrentEstablishment() establishment: EstablishmentContext): Promise<CashbackRuleResponse[]> {
    return this.service.listRules(establishment.id);
  }

  @Post('cashback-rules')
  @ApiOperation({ summary: 'Cria regra de cashback para o estabelecimento ou para uma promoção' })
  @ApiErrors(400, 422)
  createRule(@CurrentEstablishment() establishment: EstablishmentContext, @Body() dto: CashbackRuleDto): Promise<CashbackRuleResponse> {
    return this.service.createRule(establishment.id, dto);
  }

  @Patch('cashback-rules/:ruleId')
  @ApiOperation({ summary: 'Edita, ativa ou desativa a regra' })
  @ApiErrors(400, 404, 422)
  updateRule(@CurrentEstablishment() establishment: EstablishmentContext, @Param('ruleId', ParseUUIDPipe) ruleId: string, @Body() dto: UpdateCashbackRuleDto): Promise<CashbackRuleResponse> {
    return this.service.updateRule(establishment.id, ruleId, dto);
  }

  @Delete('cashback-rules/:ruleId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Exclui a regra (pedidos já criados mantêm o cashback combinado)' })
  async removeRule(@CurrentEstablishment() establishment: EstablishmentContext, @Param('ruleId', ParseUUIDPipe) ruleId: string) {
    await this.service.removeRule(establishment.id, ruleId);
  }

  @Get('coupons')
  @ApiOperation({ summary: 'Cupons do estabelecimento com usos e situação (ficha 56)' })
  listCoupons(@CurrentEstablishment() establishment: EstablishmentContext): Promise<CouponDto[]> {
    return this.service.listCoupons(establishment.id);
  }

  @Post('coupons')
  @ApiOperation({ summary: 'Cria um cupom de campanha' })
  @ApiErrors(400, 409, 422)
  createCoupon(@CurrentEstablishment() establishment: EstablishmentContext, @Body() dto: CouponBodyDto): Promise<CouponDto> {
    return this.service.createCoupon(establishment.id, dto);
  }

  @Patch('coupons/:couponId')
  @ApiOperation({ summary: 'Edita, ativa ou desativa o cupom' })
  @ApiErrors(400, 404, 422)
  updateCoupon(@CurrentEstablishment() establishment: EstablishmentContext, @Param('couponId', ParseUUIDPipe) couponId: string, @Body() dto: UpdateCouponDto): Promise<CouponDto> {
    return this.service.updateCoupon(establishment.id, couponId, dto);
  }

  @Delete('coupons/:couponId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Exclui o cupom (só se ainda não foi usado)' })
  @ApiErrors(404, 409)
  async removeCoupon(@CurrentEstablishment() establishment: EstablishmentContext, @Param('couponId', ParseUUIDPipe) couponId: string) {
    await this.service.removeCoupon(establishment.id, couponId);
  }
}
