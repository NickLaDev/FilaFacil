import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { SHARE_SOURCES, type ShareSource, type ShareVisitsDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { ToNumber } from '../../common/validation/transforms.js';
import { PrismaService } from '../../database/prisma.service.js';
import { notFound } from '../../common/http/app-error.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { Public } from '../auth/auth.decorators.js';

class ShareVisitDto {
  /** Canal do link (parâmetro `src`); valores desconhecidos viram `other`. */
  @IsOptional()
  @IsIn([...SHARE_SOURCES, 'unknown'])
  source?: ShareSource;
}

class DaysQueryDto {
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

/** Ficha 62: registra o acesso pelo link compartilhado (origem para métricas de marketing). */
@ApiTags('Restaurantes (cliente)')
@Public()
@Controller('restaurants/:id/share-visits')
export class ShareVisitsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @HttpCode(204)
  // Pública e por IP: limite para que ninguém infle a métrica em massa.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Registra a origem de um acesso pelo link compartilhado da página do restaurante' })
  @ApiErrors(400, 404, 429)
  async record(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ShareVisitDto): Promise<void> {
    const exists = await this.prisma.establishment.findFirst({ where: { id, status: 'active' }, select: { id: true } });
    if (!exists) throw notFound('Restaurante não encontrado.');
    await this.prisma.shareVisit.create({ data: { establishmentId: id, source: !dto.source || dto.source === ('unknown' as string) ? 'other' : dto.source } });
  }
}

@ApiTags('Dashboard (gestor)')
@EstablishmentScoped()
@Controller('establishments/:establishmentId/share-visits')
export class StaffShareVisitsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequireAccess(['dashboard.view'])
  @ApiOperation({ summary: 'Acessos pelo link compartilhado, por origem (ficha 62)' })
  async summary(@CurrentEstablishment() establishment: EstablishmentContext, @Query() query: DaysQueryDto): Promise<ShareVisitsDto> {
    const since = new Date(Date.now() - (query.days ?? 30) * 86_400_000);
    const groups = await this.prisma.shareVisit.groupBy({ by: ['source'], where: { establishmentId: establishment.id, createdAt: { gte: since } }, _count: { _all: true } });
    const bySource = groups.map(group => ({ source: group.source, count: group._count._all })).sort((a, b) => b.count - a.count);
    return { total: bySource.reduce((sum, row) => sum + row.count, 0), bySource };
  }
}
