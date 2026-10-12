import { Injectable } from '@nestjs/common';
import type { AvailabilityChangeDto, ManagedMenuItem, MenuCategoryDto, Page } from '@filafacil/shared';
import { notFound } from '../../common/http/app-error.js';
import { pageArgs, toPage, type PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
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
  position: true,
  updatedAt: true,
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
  position: item.position,
  updatedAt: item.updatedAt.toISOString(),
});

const itemNotFound = () => notFound('Item não encontrado neste cardápio.');

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
      const last = await tx.menuItem.aggregate({ where: { categoryId }, _max: { position: true } });
      return tx.menuItem.create({
        data: {
          establishmentId,
          categoryId,
          name: dto.name,
          description: dto.description ?? '',
          priceCents: dto.priceCents,
          imageUrl: dto.imageUrl ?? null,
          available: dto.available ?? true,
          position: (last._max.position ?? 0) + 1,
        },
        select: ITEM_SELECT,
      });
    });
    this.realtime.menuUpdated(establishmentId);
    return toManagedItem(item);
  }

  async updateItem(establishmentId: string, itemId: string, dto: UpdateMenuItemDto): Promise<ManagedMenuItem> {
    const current = await this.findItem(establishmentId, itemId);
    const item = await this.prisma.$transaction(async tx => {
      const categoryId = dto.categoryName ? await this.categoryIdFor(tx, establishmentId, dto.categoryName) : undefined;
      return tx.menuItem.update({
        where: { id: itemId },
        data: {
          name: dto.name,
          description: dto.description,
          priceCents: dto.priceCents,
          available: dto.available,
          categoryId,
          ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl, imageStorageKey: null }),
        },
        select: ITEM_SELECT,
      });
    });
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
