import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AUDIT_ACTIONS, type AuditLogDto, type Page } from '@filafacil/shared';
import { PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { PlatformAdmin } from '../access/access.decorators.js';
import { AuditService } from './audit.service.js';

class AuditQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsIn(Object.keys(AUDIT_ACTIONS))
  action?: string;

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

@ApiTags('Admin · Auditoria')
@PlatformAdmin('platform.audit')
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Log de auditoria das ações sensíveis, com filtro por usuário, ação e data (ficha 42)' })
  list(@Query() query: AuditQueryDto): Promise<Page<AuditLogDto>> {
    return this.audit.list(query);
  }
}
