import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ESTABLISHMENT_STATUSES, ESTABLISHMENT_TYPES, type EstablishmentStatus, type EstablishmentType } from '@filafacil/shared';
import { PageQueryDto } from '../../../common/pagination/page-query.dto.js';
import { Trim } from '../../../common/validation/transforms.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

export class OpeningHourInputDto {
  /** 0 = domingo … 6 = sábado. */
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @ApiProperty({ example: '17:00' })
  @Matches(TIME_PATTERN, { message: 'Use o formato HH:MM.' })
  opensAt!: string;

  /** Fechamento menor ou igual à abertura = fecha no dia seguinte (ex.: 17:00–02:00). */
  @ApiProperty({ example: '02:00' })
  @Matches(TIME_PATTERN, { message: 'Use o formato HH:MM.' })
  closesAt!: string;
}

export class CreateEstablishmentDto {
  @Trim()
  @IsString()
  @Length(2, 80)
  name!: string;

  @ApiProperty({ enum: ESTABLISHMENT_TYPES })
  @IsIn(ESTABLISHMENT_TYPES)
  type!: EstablishmentType;

  @Trim()
  @IsString()
  @Length(2, 60)
  city!: string;

  @Trim()
  @IsString()
  @Length(3, 160)
  address!: string;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  /** Fuso IANA (padrão America/Sao_Paulo). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsUUID()
  organizationId!: string;

  @IsUUID()
  planId!: string;

  @ApiPropertyOptional({ enum: ESTABLISHMENT_STATUSES })
  @IsOptional()
  @IsIn(ESTABLISHMENT_STATUSES)
  status?: EstablishmentStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  foodCategories?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];

  /** Tempo médio de espera informado pela casa (base do filtro "menor espera"). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  averageWaitMinutes?: number;

  @IsOptional()
  @IsBoolean()
  ordersPaused?: boolean;

  @IsOptional()
  @IsBoolean()
  highDemand?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(21)
  @ValidateNested({ each: true })
  @Type(() => OpeningHourInputDto)
  openingHours?: OpeningHourInputDto[];
}

export class UpdateEstablishmentDto extends PartialType(CreateEstablishmentDto) {}

export class SetEstablishmentStatusDto {
  @ApiProperty({ enum: ESTABLISHMENT_STATUSES })
  @IsIn(ESTABLISHMENT_STATUSES)
  status!: EstablishmentStatus;
}

export class SetEstablishmentPlanDto {
  @IsUUID()
  planId!: string;
}

export class ListEstablishmentsQueryDto extends PageQueryDto {
  /** Nome ou cidade. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ enum: ESTABLISHMENT_STATUSES })
  @IsOptional()
  @IsIn(ESTABLISHMENT_STATUSES)
  status?: EstablishmentStatus;
}

export class CreateOrganizationDto {
  @Trim()
  @IsString()
  @Length(2, 120)
  name!: string;
}
