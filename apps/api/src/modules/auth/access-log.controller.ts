import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import type { AccessLogDto, Page, UserAccessDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { ToBoolean } from '../../common/validation/transforms.js';
import { PlatformAdmin } from '../access/access.decorators.js';
import { AuditService } from '../audit/audit.service.js';
import { AccessLogService } from './access-log.service.js';
import { SessionService } from './session.service.js';

class AccessQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  newDevice?: boolean;
}

@ApiTags('Admin · Acessos e dispositivos')
@PlatformAdmin('platform.audit')
@Controller('admin')
export class AccessLogController {
  constructor(
    private readonly accessLogs: AccessLogService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  @Get('access-logs')
  @ApiOperation({ summary: 'Logins da plataforma (data, IP, aparelho), com filtro por usuário e por aparelho novo (ficha 52)' })
  list(@Query() query: AccessQueryDto): Promise<Page<AccessLogDto>> {
    return this.accessLogs.list(query);
  }

  @Get('users/:id/access')
  @ApiOperation({ summary: 'Sessões e histórico de acessos de um usuário' })
  @ApiErrors(404)
  forUser(@Param('id', ParseUUIDPipe) id: string): Promise<UserAccessDto> {
    return this.accessLogs.forUser(id);
  }

  @Post('sessions/:sessionId/revoke')
  @HttpCode(204)
  @ApiOperation({ summary: 'Encerra uma sessão remotamente (vale na próxima requisição do aparelho)' })
  @ApiErrors(404)
  async revoke(@Param('sessionId', ParseUUIDPipe) sessionId: string): Promise<void> {
    await this.accessLogs.revokeSession(sessionId);
  }

  @Post('users/:id/sessions/revoke-all')
  @HttpCode(204)
  @ApiOperation({ summary: 'Encerra todas as sessões do usuário' })
  async revokeAll(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.sessions.revokeAllForUser(id, 'admin_revoked');
    await this.audit.record({ action: 'sessions.revoked_all', targetType: 'user', targetId: id, summary: 'Todas as sessões do usuário encerradas pela plataforma' });
  }
}
