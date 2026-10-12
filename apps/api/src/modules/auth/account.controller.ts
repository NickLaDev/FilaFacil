import { Body, Controller, Delete, HttpCode, Post, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ApiErrors } from '../../common/http/api-docs.js';
import { AccountDeletionService } from './account-deletion.service.js';
import { clearSessionCookies } from './auth-cookies.js';
import { ClientMeta, CurrentAuth } from './auth.decorators.js';
import type { AuthContext, RequestMeta } from './auth.types.js';
import { AppConfig } from '../../config/app-config.js';
import { ContactVerificationRequestDto, DeleteAccountDto } from './dto/auth.dto.js';
import { OtpChallengeDto } from './dto/auth-responses.dto.js';

const MINUTE = 60_000;

@ApiTags('Conta (LGPD)')
@ApiCookieAuth()
@ApiErrors(401)
@Controller('me')
export class AccountController {
  constructor(
    private readonly deletion: AccountDeletionService,
    private readonly config: AppConfig,
  ) {}

  @Post('delete-account/code')
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @ApiOperation({ summary: 'Envia o código que confirma a exclusão da conta ao contato verificado (ficha 53)' })
  @ApiErrors(403, 422, 429, 503)
  requestCode(@CurrentAuth() auth: AuthContext, @Body() dto: ContactVerificationRequestDto, @ClientMeta() meta: RequestMeta): Promise<OtpChallengeDto> {
    return this.deletion.requestCode(auth.userId, dto.channel, meta.ipAddress);
  }

  @Delete()
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ApiOperation({ summary: 'Exclui a conta após nova autenticação (senha ou código); anonimiza os dados pessoais (ficha 53)' })
  @ApiErrors(400, 401, 403, 409, 429)
  async deleteAccount(@CurrentAuth() auth: AuthContext, @Body() dto: DeleteAccountDto, @Res({ passthrough: true }) response: Response) {
    await this.deletion.delete(auth.userId, dto);
    clearSessionCookies(response, this.config);
  }
}
