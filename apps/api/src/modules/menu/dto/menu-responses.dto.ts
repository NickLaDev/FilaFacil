import { ApiProperty } from '@nestjs/swagger';
import type { AvailabilityChangeDto, ManagedMenuItem, MenuCategoryDto, Page } from '@filafacil/shared';

export class ManagedMenuItemDto implements ManagedMenuItem {
  id!: string;
  categoryId!: string;
  category!: string;
  name!: string;
  description!: string;
  priceCents!: number;
  imageUrl!: string | null;
  available!: boolean;
  highlighted!: boolean;
  position!: number;
  updatedAt!: string;
}

export class MenuCategoryResponseDto implements MenuCategoryDto {
  id!: string;
  name!: string;
  position!: number;
}

export class AvailabilityChangeResponseDto implements AvailabilityChangeDto {
  id!: string;
  menuItemId!: string;
  itemName!: string;
  available!: boolean;
  /** Quem alterou (ficha 19). */
  actorName!: string;
  createdAt!: string;
}

export class AvailabilityHistoryPageDto implements Page<AvailabilityChangeResponseDto> {
  @ApiProperty({ type: [AvailabilityChangeResponseDto] })
  items!: AvailabilityChangeResponseDto[];
  page!: number;
  pageSize!: number;
  total!: number;
}
