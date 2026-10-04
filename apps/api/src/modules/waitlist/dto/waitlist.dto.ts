import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { ReleaseTablesResponse, WaitlistDto, WaitlistEntryDto, WaitlistStatus } from '@filafacil/shared';
import { Trim } from '../../../common/validation/transforms.js';

export class CreateWaitlistEntryDto {
  @Trim()
  @IsString()
  @Length(2, 80)
  name!: string;

  /** Celular com DDD, usado para avisar quando a mesa estiver pronta. */
  @IsString()
  @Length(10, 16)
  phone!: string;

  @IsInt()
  @Min(1)
  @Max(50)
  partySize!: number;
}

export class MoveWaitlistEntryDto {
  /** Nova posição na fila (1 = primeiro). */
  @IsInt()
  @Min(1)
  position!: number;
}

export class ReleaseTablesDto {
  /** Mesas que acabaram de vagar (mais de uma quando estavam juntas). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  tableIds!: string[];
}

export class WaitlistEntryResponseDto implements WaitlistEntryDto {
  id!: string;
  name!: string;
  phone!: string;
  partySize!: number;
  /** Posição atual na fila (1 = próximo). */
  position!: number;
  @ApiProperty({ enum: ['waiting', 'notified'] })
  status!: WaitlistStatus;
  joinedAt!: string;
  quotedWaitMinutes!: number;
  estimatedWaitMinutes!: number | null;
  notifiedAt!: string | null;
  notifiedTableLabel!: string | null;
}

export class WaitlistResponseDto implements WaitlistDto {
  @ApiProperty({ type: [WaitlistEntryResponseDto] })
  entries!: WaitlistEntryResponseDto[];
  /** Mesas livres agora (base da estimativa). */
  freeTables!: number;
}

export class ReleaseTablesResponseDto implements ReleaseTablesResponse {
  /** Grupo avisado automaticamente (o primeiro da fila que cabe nas mesas liberadas). */
  notifiedEntry!: WaitlistEntryResponseDto | null;
}
