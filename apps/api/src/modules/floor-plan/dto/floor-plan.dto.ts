import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import { TABLE_SHAPES, type DiningTableDto, type FloorPlanDto, type TableOccupancyStatus, type TableShape } from '@filafacil/shared';
import { Trim } from '../../../common/validation/transforms.js';

export const MAX_TABLES_PER_PLAN = 500;

export class FloorTableInputDto {
  /** Mesa existente (omitir para criar uma nova; o servidor gera o id e o QR Code). */
  @IsOptional()
  @IsUUID()
  id?: string;

  @Trim()
  @IsString()
  @Length(1, 30)
  label!: string;

  @ApiProperty({ enum: TABLE_SHAPES })
  @IsIn(TABLE_SHAPES)
  shape!: TableShape;

  @IsInt()
  @Min(1)
  @Max(30)
  capacity!: number;

  /** Centro da mesa em % da largura da planta (0–100). */
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100)
  x!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100)
  y!: number;
}

export class SaveFloorPlanDto {
  /** Versão que o editor carregou; se outra pessoa salvou antes, a API responde 409. */
  @IsInt()
  @Min(0)
  version!: number;

  @IsArray()
  @ArrayMaxSize(MAX_TABLES_PER_PLAN)
  @ValidateNested({ each: true })
  @Type(() => FloorTableInputDto)
  tables!: FloorTableInputDto[];
}

export class TableOccupancyDto {
  @ApiProperty({ enum: ['free', 'occupied'] })
  status!: TableOccupancyStatus;
  partySize!: number;
  since!: string | null;
}

export class DiningTableResponseDto implements DiningTableDto {
  id!: string;
  label!: string;
  @ApiProperty({ enum: TABLE_SHAPES })
  shape!: TableShape;
  capacity!: number;
  x!: number;
  y!: number;
  qrCode!: string;
  occupancy!: TableOccupancyDto;
}

export class FloorPlanResponseDto implements FloorPlanDto {
  establishmentId!: string;
  version!: number;
  @ApiProperty({ type: [DiningTableResponseDto] })
  tables!: DiningTableResponseDto[];
  updatedAt!: string | null;
}

export class DuplicateFloorPlanDto {
  /** Unidade que receberá uma cópia do layout (mesma organização). */
  @IsUUID()
  targetEstablishmentId!: string;

  /** Substitui as mesas que o destino já tem; sem isso, destino com mesas responde 409. */
  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}
