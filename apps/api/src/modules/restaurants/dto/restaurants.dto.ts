import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsLatitude, IsLongitude, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page-query.dto.js';
import { ToBoolean, ToList, ToNumber, Trim } from '../../../common/validation/transforms.js';

export const RESTAURANT_SORTS = ['distance', 'wait', 'name'] as const;
export type RestaurantSort = (typeof RESTAURANT_SORTS)[number];

export class SearchRestaurantsDto extends PageQueryDto {
  /** Latitude do cliente (geolocalização do aparelho). */
  @IsOptional()
  @ToNumber()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @ToNumber()
  @IsLongitude()
  lng?: number;

  /** Raio da busca em km (padrão 30). */
  @IsOptional()
  @ToNumber()
  @Min(1)
  @Max(100)
  radiusKm?: number;

  /** Só estabelecimentos abertos agora (ficha 11). */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  openNow?: boolean;

  /** distance = mais próximos (padrão com coordenadas); wait = menor espera; name = alfabética. */
  @ApiPropertyOptional({ enum: RESTAURANT_SORTS })
  @IsOptional()
  @IsIn(RESTAURANT_SORTS)
  sort?: RestaurantSort;

  /** Busca pelo nome. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  q?: string;

  /** Categoria de comida (ex.: "Petiscos"). */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40)
  category?: string;

  /** Várias categorias (ficha 60): `?categories=Bar,Petiscos` ou repetido. Basta atender a uma delas. */
  @IsOptional()
  @ToList()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  categories?: string[];
}

export class MenuQueryDto {
  /** Busca por nome ou descrição do item. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  q?: string;

  /** Nome da categoria (ex.: "Cervejas"). */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40)
  category?: string;
}
