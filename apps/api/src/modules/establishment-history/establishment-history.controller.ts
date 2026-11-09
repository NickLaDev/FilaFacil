import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { ESTABLISHMENT_FIELD_LABELS, type EstablishmentChangeDto, type Page } from '@filafacil/shared';
import { PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { PlatformAdmin } from '../access/access.decorators.js';
import { ChangeLogService } from './change-log.service.js';

class ChangeLogQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @IsOptional()
  @IsIn(Object.keys(ESTABLISHMENT_FIELD_LABELS))
  field?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}

@ApiTags('Admin · Histórico de alterações')
@PlatformAdmin('platform.establishments')
@Controller('admin/establishment-changes')
export class EstablishmentHistoryController {
  constructor(private readonly log: ChangeLogService) {}

  @Get()
  @ApiOperation({ summary: 'Histórico de alterações do cadastro dos estabelecimentos: data, autor, campo, valor antes e depois (ficha 66)' })
  list(@Query() query: ChangeLogQueryDto): Promise<Page<EstablishmentChangeDto>> {
    return this.log.list(query);
  }
}
