import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import type { Response } from 'express';
import type { OrganizationDetailDto, OrganizationReportDto, OrganizationRole, OrganizationSummaryDto, PlatformMetricsDto, PlatformOverviewDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { Trim } from '../../common/validation/transforms.js';
import { PlatformAdmin } from '../access/access.decorators.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { metricsCsv, metricsPdf } from './metrics-export.js';
import { OrganizationsService } from './organizations.service.js';
import { PlatformMetricsService } from './platform-metrics.service.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

class OverviewQueryDto {
  @IsOptional()
  @Matches(DATE)
  date?: string;
}

class MetricsQueryDto {
  @Matches(DATE, { message: 'Use a data no formato AAAA-MM-DD.' })
  from!: string;

  @Matches(DATE, { message: 'Use a data no formato AAAA-MM-DD.' })
  to!: string;

  @IsOptional()
  @Matches(DATE)
  compareFrom?: string;

  @IsOptional()
  @Matches(DATE)
  compareTo?: string;
}

class MetricsExportQueryDto extends MetricsQueryDto {
  @IsOptional()
  @IsIn(['csv', 'pdf'])
  format?: 'csv' | 'pdf';
}

class PeriodQueryDto {
  @IsOptional()
  @Matches(DATE)
  from?: string;

  @IsOptional()
  @Matches(DATE)
  to?: string;
}

class RenameDto {
  @Trim()
  @IsString()
  @Length(2, 120)
  name!: string;
}

class LinkEstablishmentDto {
  @IsUUID()
  establishmentId!: string;
}

class MemberDto {
  @IsIn(['admin', 'viewer'])
  role!: OrganizationRole;
}

@ApiTags('Admin · Visão geral e métricas')
@PlatformAdmin('platform.establishments')
@Controller('admin')
export class PlatformController {
  constructor(
    private readonly metrics: PlatformMetricsService,
    private readonly organizations: OrganizationsService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Visão geral do dia: estabelecimentos ativos, pedidos, GMV e usuários ativos × ontem (ficha 32)' })
  overview(@Query() query: OverviewQueryDto): Promise<PlatformOverviewDto> {
    return this.metrics.overview(query.date);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Pedidos, GMV e usuários ativos por dia no período, comparados com o período anterior (ficha 41)' })
  @ApiErrors(400, 422)
  platformMetrics(@Query() query: MetricsQueryDto): Promise<PlatformMetricsDto> {
    return this.metrics.metrics(query);
  }

  @Get('metrics/export')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Exporta as métricas em CSV ou PDF' })
  @ApiErrors(400, 422)
  async export(@Query() query: MetricsExportQueryDto, @Res() response: Response): Promise<void> {
    const data = await this.metrics.metrics(query);
    const name = `metricas-${query.from}_a_${query.to}`;
    if (query.format === 'pdf') {
      response.type('application/pdf').attachment(`${name}.pdf`).send(await metricsPdf(data));
      return;
    }
    response.type('text/csv; charset=utf-8').attachment(`${name}.csv`).send(metricsCsv(data));
  }

  @Get('organizations/overview')
  @ApiOperation({ summary: 'Organizações com unidades e membros (ficha 35)' })
  organizationsOverview(): Promise<OrganizationSummaryDto[]> {
    return this.organizations.list();
  }

  @Get('organizations/:id')
  @ApiOperation({ summary: 'Organização: unidades, membros e relatório consolidado do período' })
  @ApiErrors(404, 422)
  organization(@Param('id', ParseUUIDPipe) id: string, @Query() query: PeriodQueryDto): Promise<OrganizationDetailDto> {
    return this.organizations.detail(id, query);
  }

  @Patch('organizations/:id')
  @ApiOperation({ summary: 'Renomeia a organização' })
  @ApiErrors(400, 404, 409)
  rename(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RenameDto): Promise<OrganizationDetailDto> {
    return this.organizations.rename(id, dto.name);
  }

  @Post('organizations/:id/establishments')
  @ApiOperation({ summary: 'Vincula (move) um estabelecimento à organização' })
  @ApiErrors(404, 422)
  link(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkEstablishmentDto, @CurrentAuth() auth: AuthContext): Promise<OrganizationDetailDto> {
    return this.organizations.linkEstablishment(id, dto.establishmentId, { userId: auth.userId, name: auth.name });
  }

  @Put('organizations/:id/members/:userId')
  @ApiOperation({ summary: 'Define o papel do usuário na rede: admin (todas as unidades) ou viewer (só relatório)' })
  @ApiErrors(404, 422)
  setMember(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: MemberDto): Promise<OrganizationDetailDto> {
    return this.organizations.setMember(id, userId, dto.role);
  }

  @Delete('organizations/:id/members/:userId')
  @ApiOperation({ summary: 'Remove o papel na rede (e o acesso herdado às unidades)' })
  @ApiErrors(404)
  removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string): Promise<OrganizationDetailDto> {
    return this.organizations.removeMember(id, userId);
  }
}

@ApiTags('Organizações (gestor)')
@ApiCookieAuth()
@Controller('organizations')
export class MemberOrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('mine')
  @ApiOperation({ summary: 'Redes de que o usuário faz parte' })
  mine(@CurrentAuth() auth: AuthContext) {
    return this.organizations.mine(auth.userId);
  }

  @Get(':id/report')
  @ApiOperation({ summary: 'Relatório consolidado da rede (membros da organização)' })
  @ApiErrors(403, 404, 422)
  report(@Param('id', ParseUUIDPipe) id: string, @Query() query: PeriodQueryDto, @CurrentAuth() auth: AuthContext): Promise<OrganizationReportDto> {
    return this.organizations.reportForMember(auth.userId, id, query);
  }
}
