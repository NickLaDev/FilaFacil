import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import type { AppNotificationsDto } from '@filafacil/shared';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { InboxService } from './inbox.service.js';

class MarkReadDto {
  /** Sem ids: marca todos como lidos. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids?: string[];
}

@ApiTags('Avisos (cliente)')
@Controller('me/notifications')
export class MyNotificationsController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @ApiOperation({ summary: 'Avisos in-app do cliente (reserva confirmada, pedido para avaliar…)' })
  list(@CurrentAuth() auth: AuthContext): Promise<AppNotificationsDto> {
    return this.inbox.listForUser(auth.userId);
  }

  @Post('read')
  @ApiOperation({ summary: 'Marca avisos como lidos (todos, se não informar ids)' })
  async read(@CurrentAuth() auth: AuthContext, @Body() dto: MarkReadDto): Promise<void> {
    await this.inbox.markUserRead(auth.userId, dto.ids);
  }
}

@ApiTags('Avisos (equipe)')
@EstablishmentScoped()
@Controller('establishments/:establishmentId/notifications')
export class StaffNotificationsController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @RequireAccess([])
  @ApiOperation({ summary: 'Avisos in-app da casa (resposta do suporte, fatura, validade…), filtrados pela permissão' })
  list(@CurrentEstablishment() establishment: EstablishmentContext, @CurrentAuth() auth: AuthContext): Promise<AppNotificationsDto> {
    return this.inbox.listForStaff(establishment.id, auth.permissions);
  }

  @Post('read')
  @RequireAccess([])
  @ApiOperation({ summary: 'Marca avisos da casa como lidos' })
  async read(@CurrentEstablishment() establishment: EstablishmentContext, @CurrentAuth() auth: AuthContext, @Body() dto: MarkReadDto): Promise<void> {
    await this.inbox.markStaffRead(establishment.id, auth.permissions, dto.ids);
  }
}
