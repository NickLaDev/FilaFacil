import { Injectable } from '@nestjs/common';
import type { AvailabilityChangeDto, DuplicateMenuItemRequest, ManagedMenuItem, MenuCategoryDto, Page } from '@filafacil/shared';
import { conflict, notFound, unprocessable } from '../../common/http/app-error.js';
import { pageArgs, toPage, type PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { ImageUploadService, type UploadedImage } from '../storage/image-upload.service.js';
import type { CreateMenuItemDto, UpdateMenuItemDto } from './dto/menu.dto.js';

const ITEM_SELECT = {
  id: true,
  name: true,
  description: true,
  priceCents: true,
  imageUrl: true,
  imageStorageKey: true,
  available: true,
  highlighted: true,
  allergens: true,
  position: true,
  updatedAt: true,
  station: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
} satisfies Prisma.MenuItemSelect;

type ItemRow = Prisma.MenuItemGetPayload<{ select: typeof ITEM_SELECT }>;

const toManagedItem = (item: ItemRow): ManagedMenuItem => ({
  id: item.id,
  categoryId: item.category.id,
  category: item.category.name,
  name: item.name,
  description: item.description,
  priceCents: item.priceCents,
  imageUrl: item.imageUrl,
  available: item.available,
  highlighted: item.highlighted,
  allergens: item.allergens,
  stationId: item.station?.id ?? null,
  stationName: item.station?.name ?? null,
  position: item.position,
  updatedAt: item.updatedAt.toISOString(),
});

const itemNotFound = () => notFound('Item não encontrado neste cardápio.');
const duplicateItemError = () => conflict('DUPLICATE_ITEM', 'Já existe um item ativo com este nome nesta categoria. Altere o nome para criar a variação.');

/** O índice único parcial (categoria + nome, itens ativos) é a trava final contra itens idênticos, mesmo sob concorrência. */
function rethrowDuplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw duplicateItemError();
  throw error;
}

/**
 * Cardápio do ponto de vista da equipe (fichas 28 e 19). Toda consulta filtra pelo
 * estabelecimento autorizado na rota: um item de outra casa responde 404 (sem IDOR).
 */
@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImageUploadService,
    private readonly realtime: RealtimeService,
  ) {}

  async listItems(establishmentId: string): Promise<ManagedMenuItem[]> {
    const items = await this.prisma.menuItem.findMany({
      where: { establishmentId, deletedAt: null },
      orderBy: [{ category: { position: 'asc' } }, { position: 'asc' }],
      select: ITEM_SELECT,
    });
    return items.map(toManagedItem);
  }

  async listCategories(establishmentId: string): Promise<MenuCategoryDto[]> {
    return this.prisma.menuCategory.findMany({
      where: { establishmentId },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, position: true },
    });
  }

  async createItem(establishmentId: string, dto: CreateMenuItemDto): Promise<ManagedMenuItem> {
    const item = await this.prisma.$transaction(async tx => {
      const categoryId = await this.categoryIdFor(tx, establishmentId, dto.categoryName);
      const stationId = await this.stationIdFor(tx, establishmentId, dto.stationId);
      const last = await tx.menuItem.aggregate({ where: { categoryId }, _max: { position: true } });
      return tx.menuItem.create({
        data: {
          establishmentId,
          categoryId,
          stationId,
          name: dto.name,
          description: dto.description ?? '',
          priceCents: dto.priceCents,
          imageUrl: dto.imageUrl ?? null,
          available: dto.available ?? true,
          allergens: dto.allergens ?? [],
          position: (last._max.position ?? 0) + 1,
        },
        select: ITEM_SELECT,
      });
    }).catch(rethrowDuplicate);
    this.realtime.menuUpdated(establishmentId);
    return toManagedItem(item);
  }

  /**
   * Ficha 67: cria uma variação a partir de um item existente. Copia categoria, descrição, preço, alérgenos, estação
   * e a foto (cópia própria do arquivo); os campos do corpo substituem os copiados. Nunca cria dois itens ativos
   * iguais (mesmo nome na mesma categoria): sem nome informado, usa "Nome (cópia)", "Nome (cópia 2)"…
   */
  async duplicateItem(establishmentId: string, itemId: string, dto: DuplicateMenuItemRequest): Promise<ManagedMenuItem> {
    const source = await this.prisma.menuItem.findFirst({
      where: { id: itemId, establishmentId, deletedAt: null },
      select: { name: true, description: true, priceCents: true, imageUrl: true, imageStorageKey: true, available: true, allergens: true, stationId: true, category: { select: { name: true } } },
    });
    if (!source) throw itemNotFound();
    const copy = await this.images.duplicate(source.imageStorageKey);
    try {
      const item = await this.prisma.$transaction(async tx => {
        const categoryId = await this.categoryIdFor(tx, establishmentId, dto.categoryName ?? source.category.name);
        let name = dto.name?.trim();
        if (!name) {
          const taken = new Set((await tx.menuItem.findMany({ where: { categoryId, deletedAt: null }, select: { name: true } })).map(row => row.name.toLowerCase()));
          const base = source.name.slice(0, 66);
          name = `${base} (cópia)`;
          for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (cópia ${n})`;
        }
        const last = await tx.menuItem.aggregate({ where: { categoryId }, _max: { position: true } });
        return tx.menuItem.create({
          data: {
            establishmentId,
            categoryId,
            stationId: source.stationId,
            name,
            description: dto.description ?? source.description,
            priceCents: dto.priceCents ?? source.priceCents,
            imageUrl: copy ? copy.url : source.imageStorageKey ? null : source.imageUrl,
            imageStorageKey: copy?.key ?? null,
            available: source.available,
            allergens: dto.allergens ?? source.allergens,
            position: (last._max.position ?? 0) + 1,
          },
          select: ITEM_SELECT,
        });
      });
      this.realtime.menuUpdated(establishmentId);
      return toManagedItem(item);
    } catch (error) {
      await this.images.discard(copy?.key);
      return rethrowDuplicate(error);
    }
  }

  async updateItem(establishmentId: string, itemId: string, dto: UpdateMenuItemDto): Promise<ManagedMenuItem> {
    const current = await this.findItem(establishmentId, itemId);
    const item = await this.prisma.$transaction(async tx => {
      const categoryId = dto.categoryName ? await this.categoryIdFor(tx, establishmentId, dto.categoryName) : undefined;
      const stationId = dto.stationId === undefined ? undefined : await this.stationIdFor(tx, establishmentId, dto.stationId);
      return tx.menuItem.update({
        where: { id: itemId },
        data: {
          stationId,
          name: dto.name,
          description: dto.description,
          priceCents: dto.priceCents,
          available: dto.available,
          categoryId,
          ...(dto.allergens !== undefined && { allergens: dto.allergens }),
          ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl, imageStorageKey: null }),
        },
        select: ITEM_SELECT,
      });
    }).catch(rethrowDuplicate);
    // Trocar a foto enviada por um link externo libera o arquivo antigo.
    if (dto.imageUrl !== undefined) await this.images.discard(current.imageStorageKey);
    this.realtime.menuUpdated(establishmentId);
    return toManagedItem(item);
  }

  /**
   * Exclusão lógica: some do cardápio e das promoções, mas o histórico de disponibilidade
   * (e futuros pedidos) continua apontando para o item.
   */
  async deleteItem(establishmentId: string, itemId: string) {
    const current = await this.findItem(establishmentId, itemId);
    await this.prisma.$transaction([
      this.prisma.promotionItem.deleteMany({ where: { menuItemId: itemId } }),
      this.prisma.technicalSheet.deleteMany({ where: { menuItemId: itemId } }),
      this.prisma.menuItem.update({ where: { id: itemId }, data: { deletedAt: new Date(), imageUrl: null, imageStorageKey: null } }),
    ]);
    await this.images.discard(current.imageStorageKey);
    this.realtime.menuUpdated(establishmentId);
  }

  /** Foto enviada pela equipe (ficha 03): validada, reencodada e gravada no storage. */
  async setPhoto(establishmentId: string, itemId: string, file: UploadedImage | undefined): Promise<ManagedMenuItem> {
    const current = await this.findItem(establishmentId, itemId);
    const stored = await this.images.store(file);
    const item = await this.prisma.menuItem.update({
      where: { id: itemId },
      data: { imageUrl: stored.url, imageStorageKey: stored.key },
      select: ITEM_SELECT,
    });
    await this.images.discard(current.imageStorageKey);
    this.realtime.menuUpdated(establishmentId);
    return toManagedItem(item);
  }

  /**
   * Ficha 19: marca esgotado/disponível, registra quem e quando, e avisa os clientes com o
   * cardápio aberto via WebSocket (o item some em segundos, sem atualizar a página).
   */
  async setAvailability(establishmentId: string, itemId: string, available: boolean, actorId: string): Promise<ManagedMenuItem> {
    const item = await this.prisma.$transaction(async tx => {
      const current = await tx.menuItem.findFirst({ where: { id: itemId, establishmentId, deletedAt: null }, select: ITEM_SELECT });
      if (!current) throw itemNotFound();
      if (current.available === available) return { item: current, changed: false };
      const updated = await tx.menuItem.update({ where: { id: itemId }, data: { available }, select: ITEM_SELECT });
      await tx.menuItemAvailabilityChange.create({
        data: { establishmentId, menuItemId: itemId, itemName: updated.name, available, changedById: actorId },
      });
      return { item: updated, changed: true };
    });
    if (item.changed) this.realtime.availabilityChanged(establishmentId);
    return toManagedItem(item.item);
  }

  async availabilityHistory(establishmentId: string, query: PageQueryDto): Promise<Page<AvailabilityChangeDto>> {
    const where = { establishmentId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.menuItemAvailabilityChange.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
        select: { id: true, menuItemId: true, itemName: true, available: true, createdAt: true, changedBy: { select: { name: true } } },
      }),
      this.prisma.menuItemAvailabilityChange.count({ where }),
    ]);
    return toPage(
      rows.map(row => ({
        id: row.id,
        menuItemId: row.menuItemId,
        itemName: row.itemName,
        available: row.available,
        actorName: row.changedBy.name,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }

  private async findItem(establishmentId: string, itemId: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id: itemId, establishmentId, deletedAt: null },
      select: { id: true, imageStorageKey: true },
    });
    if (!item) throw itemNotFound();
    return item;
  }

  /** Estação (ficha 24) do mesmo estabelecimento; null remove a estação (= "Geral"). */
  private async stationIdFor(tx: PrismaTx, establishmentId: string, stationId: string | null | undefined) {
    if (!stationId) return null;
    const station = await tx.kitchenStation.findFirst({ where: { id: stationId, establishmentId }, select: { id: true } });
    if (!station) throw unprocessable('INVALID_STATION', 'Estação não encontrada neste estabelecimento.', [{ field: 'stationId', message: 'Estação inválida.' }]);
    return station.id;
  }

  /** Categoria pelo nome (sem diferenciar maiúsculas); cria no fim da ordem se ainda não existir. */
  private async categoryIdFor(tx: PrismaTx, establishmentId: string, name: string) {
    const existing = await tx.menuCategory.findFirst({
      where: { establishmentId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) return existing.id;
    const last = await tx.menuCategory.aggregate({ where: { establishmentId }, _max: { position: true } });
    const created = await tx.menuCategory.create({
      data: { establishmentId, name, position: (last._max.position ?? 0) + 1 },
      select: { id: true },
    });
    return created.id;
  }
}
