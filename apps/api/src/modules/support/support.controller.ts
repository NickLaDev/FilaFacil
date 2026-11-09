import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { SUPPORT_PRIORITIES, SUPPORT_STATUSES, type SupportPriority, type SupportStatus, type SupportTicketDetailDto, type SupportTicketDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { Trim } from '../../common/validation/transforms.js';
import { CurrentEstablishment, EstablishmentScoped, PlatformAdmin, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { SupportService } from './support.service.js';

class AdminTicketsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['active', 'resolved', 'all'])
  scope?: 'active' | 'resolved' | 'all';

  @IsOptional()
  @IsIn(SUPPORT_PRIORITIES)
  priority?: SupportPriority;

  @IsOptional()
  @IsIn(SUPPORT_STATUSES)
  status?: SupportStatus;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

class CreateTicketDto {
  @Trim()
  @IsString()
  @Length(3, 120)
  subject!: string;

  @IsIn(SUPPORT_PRIORITIES)
  priority!: SupportPriority;

  @Trim()
  @IsString()
  @Length(1, 2000)
  message!: string;
}

class MessageDto {
  @Trim()
  @IsString()
  @Length(1, 2000)
  body!: string;
}

class UpdateTicketDto {
  @IsOptional()
  @IsIn(SUPPORT_STATUSES)
  status?: SupportStatus;

  @IsOptional()
  @IsIn(SUPPORT_PRIORITIES)
  priority?: SupportPriority;
}

@ApiTags('Admin · Central de suporte')
@PlatformAdmin('platform.support')
@Controller('admin/support/tickets')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @ApiOperation({ summary: 'Fila de chamados priorizada por urgência (ficha 39)' })
  list(@Query() query: AdminTicketsQueryDto) {
    return this.support.listForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chamado com o histórico de conversa' })
  @ApiErrors(404)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<SupportTicketDetailDto> {
    return this.support.getForAdmin(id);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Responde o chamado; o estabelecimento é notificado' })
  @ApiErrors(400, 404)
  reply(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @Body() dto: MessageDto): Promise<SupportTicketDetailDto> {
    return this.support.replyAsPlatform(id, { userId: auth.userId, name: auth.name }, dto.body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Altera o status (aberto, em andamento, resolvido) e a urgência' })
  @ApiErrors(400, 404)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto): Promise<SupportTicketDetailDto> {
    return this.support.updateForAdmin(id, dto);
  }
}

@ApiTags('Suporte (gestor)')
@EstablishmentScoped()
@RequireAccess(['support.request'])
@Controller('establishments/:establishmentId/support/tickets')
export class EstablishmentSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @ApiOperation({ summary: 'Chamados do estabelecimento' })
  list(@CurrentEstablishment() establishment: EstablishmentContext): Promise<SupportTicketDto[]> {
    return this.support.listForEstablishment(establishment.id);
  }

  @Post()
  @ApiOperation({ summary: 'Abre um chamado com a urgência escolhida' })
  @ApiErrors(400)
  create(@CurrentEstablishment() establishment: EstablishmentContext, @CurrentAuth() auth: AuthContext, @Body() dto: CreateTicketDto): Promise<SupportTicketDetailDto> {
    return this.support.create(establishment.id, { userId: auth.userId, name: auth.name }, dto);
  }

  @Get(':ticketId')
  @ApiOperation({ summary: 'Chamado com o histórico de conversa' })
  @ApiErrors(404)
  get(@CurrentEstablishment() establishment: EstablishmentContext, @Param('ticketId', ParseUUIDPipe) ticketId: string): Promise<SupportTicketDetailDto> {
    return this.support.getForEstablishment(establishment.id, ticketId);
  }

  @Post(':ticketId/messages')
  @ApiOperation({ summary: 'Responde ao chamado (reabre se estava resolvido)' })
  @ApiErrors(400, 404)
  reply(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @CurrentAuth() auth: AuthContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: MessageDto,
  ): Promise<SupportTicketDetailDto> {
    return this.support.replyAsEstablishment(establishment.id, ticketId, { userId: auth.userId, name: auth.name }, dto.body);
  }

  @Post(':ticketId/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'A casa encerra o chamado' })
  @ApiErrors(404)
  resolve(@CurrentEstablishment() establishment: EstablishmentContext, @Param('ticketId', ParseUUIDPipe) ticketId: string): Promise<SupportTicketDetailDto> {
    return this.support.resolveAsEstablishment(establishment.id, ticketId);
  }
}
