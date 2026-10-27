import { Injectable } from '@nestjs/common';
import type { IngredientDto, UpdateIngredientStockRequest } from '@filafacil/shared';
import { notFound } from '../../common/http/app-error.js';
import { lockResource } from '../../database/advisory-lock.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AlertsService } from '../kitchen/alerts.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { toIngredientDto } from '../technical-sheets/technical-sheets.service.js';

const ZERO = new Prisma.Decimal(0);

/**
 * Estoque de insumos (ficha 50). A baixa pela ficha técnica acontece exatamente uma vez por pedido, na transição
 * para `preparing` (marca `orders.stock_consumed_at` + movimento único por pedido/insumo). Cancelar antes do preparo
 * não baixa; depois do preparo o consumo não é revertido. O estoque nunca fica negativo (baixa limitada ao saldo).
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Dentro da transação da transição para `preparing`. Devolve true quando fez a baixa agora. */
  async consumeForOrder(tx: PrismaTx, orderId: string): Promise<boolean> {
    const claimed = await tx.order.updateMany({ where: { id: orderId, stockConsumedAt: null }, data: { stockConsumedAt: new Date() } });
    if (claimed.count === 0) return false; // já baixado
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        establishmentId: true,
        items: { select: { quantity: true, menuItem: { select: { technicalSheet: { select: { items: { select: { ingredientId: true, quantity: true } } } } } } } },
      },
    });
    const needs = new Map<string, Prisma.Decimal>();
    for (const item of order.items) {
      for (const line of item.menuItem.technicalSheet?.items ?? []) {
        needs.set(line.ingredientId, (needs.get(line.ingredientId) ?? ZERO).plus(line.quantity.mul(item.quantity)));
      }
    }
    if (needs.size === 0) return true;
    await lockResource(tx, `stock:${order.establishmentId}`);
    const ingredients = await tx.ingredient.findMany({ where: { id: { in: [...needs.keys()] }, stockQuantity: { not: null } }, orderBy: { id: 'asc' } });
    for (const ingredient of ingredients) {
      const current = ingredient.stockQuantity as Prisma.Decimal;
      const need = needs.get(ingredient.id) as Prisma.Decimal;
      const next = Prisma.Decimal.max(current.minus(need), ZERO);
      await tx.ingredient.update({ where: { id: ingredient.id }, data: { stockQuantity: next } });
      // Consumo maior que o saldo: a baixa para em zero e a diferença é registrada como ruptura (sinalizada ao gestor).
      const shortfall = Prisma.Decimal.max(need.minus(current), ZERO);
      await tx.stockMovement.create({ data: { ingredientId: ingredient.id, orderId, quantity: next.minus(current), balanceAfter: next, reason: 'order', shortfall } });
    }
    return true;
  }

  /** Depois do commit do preparo: alerta de ruptura para cada insumo que não cobriu o pedido. */
  async signalShortfalls(establishmentId: string, orderId: string): Promise<void> {
    const rows = await this.prisma.stockMovement.findMany({ where: { orderId, shortfall: { gt: 0 } }, include: { ingredient: true, order: { select: { number: true } } } });
    for (const row of rows) {
      await this.alerts.open(
        establishmentId,
        'stock_shortfall',
        row.ingredientId,
        `Ruptura: faltou ${row.shortfall.toFixed(2)} ${row.ingredient.unit} de ${row.ingredient.name} no pedido #${row.order?.number ?? ''}.`,
      );
    }
  }

  /** Abre alerta (uma vez, até resolver) para insumo com estoque ≤ mínimo e fecha o de quem foi reposto. */
  async syncAlerts(establishmentId: string): Promise<void> {
    const all = await this.prisma.ingredient.findMany({ where: { establishmentId } });
    for (const ingredient of all) {
      const stock = ingredient.stockQuantity;
      if (stock === null) {
        await this.alerts.resolve(establishmentId, 'low_stock', ingredient.id);
        await this.alerts.resolve(establishmentId, 'stock_shortfall', ingredient.id);
      } else if (stock.lessThanOrEqualTo(ingredient.minStockQuantity)) {
        await this.alerts.open(establishmentId, 'low_stock', ingredient.id, `Estoque baixo: ${ingredient.name} (${stock.toFixed(2)} ${ingredient.unit}, mínimo ${ingredient.minStockQuantity.toFixed(2)}).`);
      } else {
        await this.alerts.resolve(establishmentId, 'low_stock', ingredient.id);
        await this.alerts.resolve(establishmentId, 'stock_shortfall', ingredient.id);
      }
    }
    this.realtime.stockUpdated(establishmentId);
  }

  async update(establishmentId: string, ingredientId: string, dto: UpdateIngredientStockRequest, actorId: string): Promise<IngredientDto> {
    await this.prisma.$transaction(async tx => {
      await lockResource(tx, `stock:${establishmentId}`);
      const current = await tx.ingredient.findFirst({ where: { id: ingredientId, establishmentId } });
      if (!current) throw notFound('Insumo não encontrado.');
      const stock = dto.stockQuantity === null ? null : new Prisma.Decimal(String(dto.stockQuantity));
      await tx.ingredient.update({
        where: { id: ingredientId },
        data: { stockQuantity: stock, ...(dto.minStockQuantity !== undefined && { minStockQuantity: new Prisma.Decimal(String(dto.minStockQuantity)) }) },
      });
      if (stock) {
        await tx.stockMovement.create({
          data: { ingredientId, quantity: stock.minus(current.stockQuantity ?? ZERO), balanceAfter: stock, reason: 'adjustment', actorId },
        });
      }
    });
    await this.syncAlerts(establishmentId);
    const row = await this.prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId }, include: { _count: { select: { sheetItems: true } } } });
    return toIngredientDto(row, row._count.sheetItems);
  }
}
