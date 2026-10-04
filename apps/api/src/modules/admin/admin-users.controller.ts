import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-docs.js';
import { PlatformAdmin } from '../access/access.decorators.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { AdminUsersService } from './admin-users.service.js';
import { ListAuditQueryDto, ListUsersQueryDto, SetUserStatusDto, UpdateUserAccessDto } from './dto/admin-users.dto.js';
import { AdminUserResponseDto, AdminUsersPageDto, PermissionAuditPageDto } from './dto/admin-responses.dto.js';

@ApiTags('Admin · Usuários')
@PlatformAdmin('platform.users')
@Controller('admin')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get('users')
  @ApiOperation({ summary: 'Usuários com busca, filtro por papel/status e contagem por papel (ficha 36)' })
  list(@Query() query: ListUsersQueryDto): Promise<AdminUsersPageDto> {
    return this.users.list(query);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Detalhe do usuário' })
  @ApiErrors(404)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserResponseDto> {
    return this.users.get(id);
  }

  @Patch('users/:id/access')
  @ApiOperation({ summary: 'Edita papel, permissões e vínculos (registrado no histórico)' })
  @ApiErrors(400, 404, 422)
  updateAccess(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserAccessDto): Promise<AdminUserResponseDto> {
    return this.users.updateAccess(auth, id, dto);
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Suspende (derruba todas as sessões na hora) ou reativa' })
  @ApiErrors(400, 404, 422)
  setStatus(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetUserStatusDto): Promise<AdminUserResponseDto> {
    return this.users.setStatus(auth, id, dto.status);
  }

  @Get('permission-audit')
  @ApiOperation({ summary: 'Histórico de alterações de permissão: quem, quem foi afetado, antes, depois e quando' })
  audit(@Query() query: ListAuditQueryDto): Promise<PermissionAuditPageDto> {
    return this.users.audit(query);
  }
}
