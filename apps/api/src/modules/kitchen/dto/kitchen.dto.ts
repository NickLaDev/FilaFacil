import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateIf } from 'class-validator';
import { Trim } from '../../../common/validation/transforms.js';

export class CreateStationDto {
  @Trim()
  @IsString()
  @Length(1, 40)
  name!: string;
}

export class UpdateStationDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 40)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  position?: number;
}

export class CreatePrinterDto {
  @Trim()
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  stationId?: string | null;
}

export class UpdatePrinterDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 60)
  name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  stationId?: string | null;
}
