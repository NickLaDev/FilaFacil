import { ApiProperty } from '@nestjs/swagger';
import {
  ESTABLISHMENT_TYPES,
  type EstablishmentType,
  type OpeningHourDto,
  type OrderingStatus,
  type Page,
  type PublicMenu,
  type PublicMenuItem,
  type PublicPromotion,
  type QrResolveDto,
  type RestaurantDetail,
  type RestaurantSummary,
} from '@filafacil/shared';

const ORDERING_STATUSES = ['open', 'busy', 'paused', 'closed'];

export class OpeningHourResponseDto implements OpeningHourDto {
  /** 0 = domingo … 6 = sábado. */
  weekday!: number;
  @ApiProperty({ example: '17:00' })
  opensAt!: string;
  @ApiProperty({ example: '02:00', description: 'Menor que a abertura = fecha no dia seguinte.' })
  closesAt!: string;
}

export class RestaurantSummaryDto implements RestaurantSummary {
  id!: string;
  name!: string;
  @ApiProperty({ enum: ESTABLISHMENT_TYPES })
  type!: EstablishmentType;
  foodCategories!: string[];
  tags!: string[];
  address!: string;
  city!: string;
  latitude!: number;
  longitude!: number;
  /** Distância em linha reta, em metros (null sem coordenadas do cliente). */
  distanceM!: number | null;
  rating!: number;
  ratingCount!: number;
  averageWaitMinutes!: number;
  @ApiProperty({ enum: ORDERING_STATUSES })
  orderingStatus!: OrderingStatus;
  /** Status "aceitando pedidos" (ficha 11). */
  acceptingOrders!: boolean;
  isOpenNow!: boolean;
  @ApiProperty({ example: 'Hoje: 17:00–02:00' })
  hoursLabel!: string;
  images!: string[];
}

export class RestaurantPageDto implements Page<RestaurantSummaryDto> {
  @ApiProperty({ type: [RestaurantSummaryDto] })
  items!: RestaurantSummaryDto[];
  page!: number;
  pageSize!: number;
  total!: number;
}

export class RestaurantDetailDto extends RestaurantSummaryDto implements RestaurantDetail {
  @ApiProperty({ example: 'America/Sao_Paulo' })
  timezone!: string;
  @ApiProperty({ type: [OpeningHourResponseDto] })
  openingHours!: OpeningHourResponseDto[];
  /** Mostra o botão "Reservar": restaurante aberto e plano com fila de espera. */
  reservationsOpen!: boolean;
}

export class PublicPromotionDto implements PublicPromotion {
  id!: string;
  name!: string;
  discountPercent!: number;
  endsAt!: string;
}

export class PublicMenuItemDto implements PublicMenuItem {
  id!: string;
  categoryId!: string;
  category!: string;
  name!: string;
  description!: string;
  priceCents!: number;
  /** Preço vigente calculado pelo servidor. */
  finalPriceCents!: number;
  imageUrl!: string | null;
  promotion!: PublicPromotionDto | null;
  /** Entre os mais vendidos dos últimos 30 dias (ficha 46). */
  isTopOrdered!: boolean;
  /** Destaque manual do gestor (ficha 46). */
  isHighlighted!: boolean;
}

export class PublicCategoryDto {
  id!: string;
  name!: string;
}

export class PublicMenuDto implements PublicMenu {
  establishmentId!: string;
  @ApiProperty({ type: [PublicCategoryDto] })
  categories!: PublicCategoryDto[];
  @ApiProperty({ type: [PublicMenuItemDto] })
  items!: PublicMenuItemDto[];
}

export class QrResolveResponseDto implements QrResolveDto {
  establishmentId!: string;
  establishmentName!: string;
  tableId!: string;
  tableLabel!: string;
  @ApiProperty({ enum: ORDERING_STATUSES })
  orderingStatus!: OrderingStatus;
  acceptingOrders!: boolean;
}

export class RestaurantCategoriesResponseDto {
  categories!: string[];
}
