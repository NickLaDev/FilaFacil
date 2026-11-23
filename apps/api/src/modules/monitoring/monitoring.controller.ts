import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateIf } from 'class-validator';
import { INTEGRATION_KINDS, type IntegrationDetailDto, type IncidentDto, type IntegrationCreatedDto, type IntegrationKind, type MonitoringOverviewDto, type Page } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { SkipCsrf } from '../../common/security/csrf.guard.js';
import { PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { ToBoolean, Trim } from '../../common/validation/transforms.js';
import { PlatformAdmin } from '../access/access.decorators.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Public } from '../auth/auth.decorators.js';
import { MonitoringService } from './monitoring.service.js';

class CreateIntegrationDto {
  @IsUUID()
  establishmentId!: string;

  @Trim()
  @IsString()
  @Length(2, 60)
  name!: string;

  @IsIn(INTEGRATION_KINDS)
  kind!: IntegrationKind;

  /** Ficha 40: URL de saúde testada pelo monitor (https). Vazio = só heartbeat. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsString()
  @MaxLength(300)
  healthUrl?: string | null;
}

class UpdateIntegrationDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsString()
  @MaxLength(300)
  healthUrl?: string | null;

  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 60)
  name?: string;
}

class IncidentsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  active?: boolean;
}

class HeartbeatDto {
  @IsOptional()
  @IsIn(['ok', 'error'])
  status?: 'ok' | 'error';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;
}

@ApiTags('Admin · Integrações e incidentes')
@PlatformAdmin('platform.monitoring')
@Controller('admin/monitoring')
export class AdminMonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get()
  @ApiOperation({ summary: 'Integrações, incidentes ativos e quantos estabelecimentos estão impactados (ficha 33)' })
  overview(): Promise<MonitoringOverviewDto> {
    return this.monitoring.overview();
  }

  @Get('incidents')
  @ApiOperation({ summary: 'Histórico de incidentes para auditoria (nunca apagado)' })
  history(@Query() query: IncidentsQueryDto): Promise<Page<IncidentDto>> {
    return this.monitoring.history(query);
  }

  @Post('integrations')
  @ApiOperation({ summary: 'Registra uma integração de um estabelecimento (a chave do dispositivo é mostrada uma única vez)' })
  @ApiErrors(400, 409, 422)
  create(@Body() dto: CreateIntegrationDto): Promise<IntegrationCreatedDto> {
    return this.monitoring.createIntegration(dto);
  }

  @Get('integrations/:id')
  @ApiOperation({ summary: 'Integração com o histórico de testes e falhas (ficha 40)' })
  @ApiErrors(404)
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<IntegrationDetailDto> {
    return this.monitoring.detail(id);
  }

  @Patch('integrations/:id')
  @ApiOperation({ summary: 'Ativa/desativa a integração do estabelecimento ou altera a URL de saúde' })
  @ApiErrors(400, 404, 409, 422)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateIntegrationDto): Promise<IntegrationDetailDto> {
    return this.monitoring.updateIntegration(id, dto);
  }

  @Post('integrations/:id/test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Testa a conexão agora: falha deixa "indisponível" e abre incidente na hora' })
  @ApiErrors(404)
  test(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext): Promise<IntegrationDetailDto> {
    return this.monitoring.testIntegration(id, auth.userId);
  }

  @Post('integrations/:id/rotate-key')
  @HttpCode(200)
  @ApiOperation({ summary: 'Gera uma nova chave (a anterior deixa de valer)' })
  @ApiErrors(404)
  rotate(@Param('id', ParseUUIDPipe) id: string): Promise<IntegrationCreatedDto> {
    return this.monitoring.rotateKey(id);
  }

  @Delete('integrations/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove uma integração sem histórico de incidentes' })
  @ApiErrors(404, 409)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.monitoring.removeIntegration(id);
  }
}

/** Rota do dispositivo: sem sessão nem cookie; autentica pela chave própria (`X-Integration-Key`). */
@ApiTags('Integrações (dispositivo)')
@Controller('integrations')
export class IntegrationDeviceController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Post('heartbeat')
  @Public()
  @SkipCsrf()
  @HttpCode(204)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Heartbeat da integração (a cada ≤ 15 s). Sem sinal por 30 s = incidente; `status: error` informa falha na hora' })
  @ApiErrors(400, 401)
  async heartbeat(@Headers('x-integration-key') key: string | undefined, @Body() dto: HeartbeatDto): Promise<void> {
    await this.monitoring.heartbeat(key, dto);
  }
}
