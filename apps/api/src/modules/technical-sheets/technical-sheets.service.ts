import { Injectable } from '@nestjs/common';
import type { IngredientDto, TechnicalSheetDto } from '@filafacil/shared';
import { conflict, notFound, unprocessable } from '../../common/http/app-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { CreateIngredientDto, UpdateIngredientDto, UpsertTechnicalSheetDto } from './dto/technical-sheets.dto.js';
import { calculateSheetCost } from './sheet-cost.js';

const SHEET_INCLUDE = {
  menuItem: { select: { name: true, priceCents: true } },
  items: {
    orderBy: { ingredient: { name: 'asc' } },
    select: { quantity: true, ingredient: { select: { id: true, name: true, unit: true, unitCost: true } } },
  },
} satisfies Prisma.TechnicalSheetInclude;

type SheetRow = Prisma.TechnicalSheetGetPayload<{ include: typeof SHEET_INCLUDE }>;

/** O custo nunca vem do cliente nem fica gravado: é recalculado a cada leitura com o preço atual dos insumos. */
function toSheetDto(sheet: SheetRow): TechnicalSheetDto {
  const cost = calculateSheetCost(
    sheet.items.map(item => ({ quantity: item.quantity, unitCost: item.ingredient.unitCost })),
    sheet.menuItem.priceCents,
    sheet.costLimitPercent,
  );
  return {
    id: sheet.id,
    menuItemId: sheet.menuItemId,
    menuItemName: sheet.menuItem.name,
    priceCents: sheet.menuItem.priceCents,
    costLimitPercent: sheet.costLimitPercent.toNumber(),
    lines: sheet.items.map((item, index) => ({
      ingredientId: item.ingredient.id,
      ingredientName: item.ingredient.name,
      unit: item.ingredient.unit,
      quantity: item.quantity.toString(),
      unitCost: item.ingredient.unitCost.toString(),
      lineCost: (cost.lineCosts[index] ?? new Prisma.Decimal(0)).toString(),
    })),
    totalCost: cost.totalCost.toFixed(4),
    costPercent: cost.costPercent,
    overLimit: cost.overLimit,
    updatedAt: sheet.updatedAt.toISOString(),
  };
}

const duplicateIngredient = () => conflict('INGREDIENT_EXISTS', 'Já existe um insumo com esse nome.', [{ field: 'name', message: 'Nome já cadastrado.' }]);

/** Ficha 31: insumos com custo unitário e fichas técnicas vinculadas aos itens do cardápio. */
@Injectable()
export class TechnicalSheetsService {
  constructor(private readonly prisma: PrismaService) {}

  async listIngredients(establishmentId: string): Promise<IngredientDto[]> {
    const ingredients = await this.prisma.ingredient.findMany({
      where: { establishmentId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { sheetItems: true } } },
    });
    return ingredients.map(({ id, name, unit, unitCost, _count }) => ({ id, name, unit, unitCost: unitCost.toFixed(4), usedInSheets: _count.sheetItems }));
  }

  async createIngredient(establishmentId: string, dto: CreateIngredientDto): Promise<IngredientDto> {
    try {
      const ingredient = await this.prisma.ingredient.create({
        data: { establishmentId, name: dto.name, unit: dto.unit, unitCost: new Prisma.Decimal(String(dto.unitCost)) },
      });
      return { id: ingredient.id, name: ingredient.name, unit: ingredient.unit, unitCost: ingredient.unitCost.toFixed(4), usedInSheets: 0 };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw duplicateIngredient();
      throw error;
    }
  }

  /** Mudar o custo de um insumo recalcula automaticamente todas as fichas que o usam. */
  async updateIngredient(establishmentId: string, ingredientId: string, dto: UpdateIngredientDto): Promise<IngredientDto> {
    await this.findIngredient(establishmentId, ingredientId);
    try {
      const ingredient = await this.prisma.ingredient.update({
        where: { id: ingredientId },
        data: { name: dto.name, unit: dto.unit, ...(dto.unitCost !== undefined && { unitCost: new Prisma.Decimal(String(dto.unitCost)) }) },
        include: { _count: { select: { sheetItems: true } } },
      });
      return { id: ingredient.id, name: ingredient.name, unit: ingredient.unit, unitCost: ingredient.unitCost.toFixed(4), usedInSheets: ingredient._count.sheetItems };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw duplicateIngredient();
      throw error;
    }
  }

  /** Excluir um insumo o remove das fichas que o usavam (custo recalculado). */
  async deleteIngredient(establishmentId: string, ingredientId: string) {
    const { count } = await this.prisma.ingredient.deleteMany({ where: { id: ingredientId, establishmentId } });
    if (count === 0) throw notFound('Insumo não encontrado.');
  }

  async listSheets(establishmentId: string): Promise<TechnicalSheetDto[]> {
    const sheets = await this.prisma.technicalSheet.findMany({
      where: { menuItem: { establishmentId, deletedAt: null } },
      orderBy: { menuItem: { name: 'asc' } },
      include: SHEET_INCLUDE,
    });
    return sheets.map(toSheetDto);
  }

  /** Uma ficha por item: cria ou substitui as linhas por completo. */
  async upsertSheet(establishmentId: string, menuItemId: string, dto: UpsertTechnicalSheetDto): Promise<TechnicalSheetDto> {
    const item = await this.prisma.menuItem.findFirst({ where: { id: menuItemId, establishmentId, deletedAt: null }, select: { id: true } });
    if (!item) throw notFound('Item não encontrado neste cardápio.');

    const ingredientIds = dto.lines.map(line => line.ingredientId);
    if (new Set(ingredientIds).size !== ingredientIds.length) {
      throw unprocessable('DUPLICATE_INGREDIENT', 'Cada insumo aparece uma vez por ficha.', [{ field: 'lines', message: 'Insumo repetido.' }]);
    }
    const owned = await this.prisma.ingredient.count({ where: { id: { in: ingredientIds }, establishmentId } });
    if (owned !== ingredientIds.length) {
      throw unprocessable('INVALID_INGREDIENTS', 'Use apenas insumos cadastrados neste estabelecimento.', [{ field: 'lines', message: 'Insumo inválido.' }]);
    }

    const sheet = await this.prisma.$transaction(async tx => {
      const limit = new Prisma.Decimal(String(dto.costLimitPercent));
      const saved = await tx.technicalSheet.upsert({
        where: { menuItemId },
        create: { menuItemId, costLimitPercent: limit },
        update: { costLimitPercent: limit },
        select: { id: true },
      });
      await tx.technicalSheetItem.deleteMany({ where: { technicalSheetId: saved.id } });
      await tx.technicalSheetItem.createMany({
        data: dto.lines.map(line => ({ technicalSheetId: saved.id, ingredientId: line.ingredientId, quantity: new Prisma.Decimal(String(line.quantity)) })),
      });
      // Atualiza o carimbo de alteração mesmo quando só as linhas mudaram.
      return tx.technicalSheet.update({ where: { id: saved.id }, data: { updatedAt: new Date() }, include: SHEET_INCLUDE });
    });
    return toSheetDto(sheet);
  }

  async deleteSheet(establishmentId: string, menuItemId: string) {
    const { count } = await this.prisma.technicalSheet.deleteMany({ where: { menuItemId, menuItem: { establishmentId } } });
    if (count === 0) throw notFound('Ficha técnica não encontrada.');
  }

  private async findIngredient(establishmentId: string, ingredientId: string) {
    const ingredient = await this.prisma.ingredient.findFirst({ where: { id: ingredientId, establishmentId }, select: { id: true } });
    if (!ingredient) throw notFound('Insumo não encontrado.');
    return ingredient;
  }
}
