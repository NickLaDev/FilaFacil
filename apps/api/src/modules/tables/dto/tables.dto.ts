import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsDate, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { Trim } from '../../../common/validation/transforms.js';

export class OccupyTableDto {
  /** Pessoas na mesa. */
  @IsInt()
  @Min(1)
  @Max(200)
  partySize!: number;
}

export class CreateReservationDto {
  @Trim()
  @IsString()
  @Length(2, 80)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(200)
  partySize!: number;

  /** Horário da reserva (ISO 8601); sem valor, vale agora. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  reservedAt?: Date;
}

export class CreateTableCallDto {
  @IsUUID()
  tableId!: string;
}

export class MergeTablesDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  tableIds!: string[];
}
