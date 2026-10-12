import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { PasskeyDto, WebAuthnOptionsDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { AppConfig } from '../../config/app-config.js';
import { MeResponseDto } from '../me/dto/me-responses.dto.js';
import { MeService } from '../me/me.service.js';
import { setSessionCookies } from './auth-cookies.js';
import { ClientMeta, CurrentAuth, Public } from './auth.decorators.js';
import type { AuthContext, RequestMeta } from './auth.types.js';
import { OtpChallengeDto } from './dto/auth-responses.dto.js';
import { ContactVerificationRequestDto } from './dto/auth.dto.js';
import { WebAuthnLoginVerifyDto, WebAuthnRegisterOptionsDto, WebAuthnRegisterVerifyDto } from './dto/webauthn.dto.js';
import { SessionService } from './session.service.js';
import { WebAuthnService } from './webauthn.service.js';

const MINUTE = 60_000;

@ApiTags('Biometria (WebAuthn)')
@Controller('auth/webauthn')
export class WebAuthnController {
  constructor(
    private readonly webauthn: WebAuthnService,
    private readonly sessions: SessionService,
    private readonly me: MeService,
    private readonly config: AppConfig,
  ) {}

  @Post('register/code')
  @HttpCode(200)
  @ApiCookieAuth()
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @ApiOperation({ summary: 'Envia o código que confirma a ativação da biometria em contas sem senha (ficha 59)' })
  @ApiErrors(401, 422, 429, 503)
  registerCode(@CurrentAuth() auth: AuthContext, @Body() dto: ContactVerificationRequestDto, @ClientMeta() meta: RequestMeta): Promise<OtpChallengeDto> {
    return this.webauthn.requestRegistrationCode(auth.userId, dto.channel, meta.ipAddress);
  }

  @Post('register/options')
  @HttpCode(200)
  @ApiCookieAuth()
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ApiOperation({ summary: 'Opções para cadastrar a biometria deste aparelho (ficha 59)' })
  @ApiErrors(401, 422, 429)
  registerOptions(@CurrentAuth() auth: AuthContext, @Body() dto: WebAuthnRegisterOptionsDto): Promise<WebAuthnOptionsDto> {
    return this.webauthn.registrationOptions(auth.userId, dto);
  }

  @Post('register/verify')
  @ApiCookieAuth()
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ApiOperation({ summary: 'Confere a credencial criada pelo aparelho e ativa a biometria (ficha 59)' })
  @ApiErrors(400, 401, 409, 429)
  registerVerify(@CurrentAuth() auth: AuthContext, @Body() dto: WebAuthnRegisterVerifyDto): Promise<PasskeyDto> {
    return this.webauthn.verifyRegistration(auth.userId, dto.challengeId, dto.response as unknown as RegistrationResponseJSON, dto.deviceName);
  }

  @Public()
  @Post('login/options')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: MINUTE } })
  @ApiOperation({ summary: 'Desafio para entrar com a biometria, sem digitar e-mail, celular ou senha (ficha 59)' })
  @ApiErrors(429)
  loginOptions(): Promise<WebAuthnOptionsDto> {
    return this.webauthn.authenticationOptions();
  }

  @Public()
  @Post('login/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ApiOperation({ summary: 'Confere a assinatura do aparelho e abre a sessão (ficha 59)' })
  @ApiErrors(400, 403, 429)
  async loginVerify(@Body() dto: WebAuthnLoginVerifyDto, @ClientMeta() meta: RequestMeta, @Res({ passthrough: true }) response: Response): Promise<MeResponseDto> {
    const userId = await this.webauthn.verifyAuthentication(dto.challengeId, dto.response as unknown as AuthenticationResponseJSON);
    setSessionCookies(response, await this.sessions.create(userId, meta), this.config);
    return this.me.getMe(userId);
  }

  @Get('credentials')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Aparelhos com biometria ativada na conta' })
  @ApiErrors(401)
  list(@CurrentAuth() auth: AuthContext): Promise<PasskeyDto[]> {
    return this.webauthn.list(auth.userId);
  }

  @Delete('credentials/:id')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Desativa a biometria de um aparelho' })
  @ApiErrors(401, 404)
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.webauthn.remove(auth.userId, id);
  }
}
