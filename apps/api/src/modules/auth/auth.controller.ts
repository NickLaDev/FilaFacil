import { Body, Controller, Get, HttpCode, Logger, Param, ParseEnumPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppConfig } from '../../config/app-config.js';
import { ApiErrors } from '../../common/http/api-docs.js';
import { AppError } from '../../common/http/app-error.js';
import { SkipCsrf } from '../../common/security/csrf.guard.js';
import { MeResponseDto } from '../me/dto/me-responses.dto.js';
import { MeService } from '../me/me.service.js';
import { clearSessionCookies, REFRESH_COOKIE, setSessionCookies } from './auth-cookies.js';
import { ClientMeta, CurrentAuth, Public } from './auth.decorators.js';
import { AuthService } from './auth.service.js';
import type { AuthContext, RequestMeta } from './auth.types.js';
import { ContactVerificationConfirmDto, ContactVerificationRequestDto, LoginDto, OtpRequestDto, OtpVerifyDto, PasswordResetConfirmDto, PasswordResetRequestDto, RegisterDto } from './dto/auth.dto.js';
import { AuthProvidersDto, OtpChallengeDto } from './dto/auth-responses.dto.js';
import type { OAuthProviderId } from './oauth/oauth-provider.js';
import { OAuthService } from './oauth/oauth.service.js';
import { SessionService } from './session.service.js';

const PROVIDERS = { google: 'google', apple: 'apple' } as const;
const providerPipe = new ParseEnumPipe(PROVIDERS);
const MINUTE = 60_000;
const MAX_APPLE_USER_PAYLOAD = 2_000;

@ApiTags('Autenticação')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly oauth: OAuthService,
    private readonly me: MeService,
    private readonly config: AppConfig,
  ) {}

  private async startSession(userId: string, meta: RequestMeta, response: Response) {
    const session = await this.sessions.create(userId, meta);
    setSessionCookies(response, session, this.config);
    return this.me.getMe(userId);
  }

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @ApiOperation({ summary: 'Cadastro por nome e CPF (ficha 01); já abre a sessão' })
  @ApiErrors(400, 409, 422, 429)
  async register(@Body() dto: RegisterDto, @ClientMeta() meta: RequestMeta, @Res({ passthrough: true }) response: Response): Promise<MeResponseDto> {
    return this.startSession(await this.auth.register(dto), meta, response);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ApiOperation({ summary: 'Login com e-mail e senha (ficha 06)' })
  @ApiErrors(400, 401, 403, 429)
  async login(@Body() dto: LoginDto, @ClientMeta() meta: RequestMeta, @Res({ passthrough: true }) response: Response): Promise<MeResponseDto> {
    return this.startSession(await this.auth.verifyPassword(dto), meta, response);
  }

  @Public()
  @Post('otp')
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @ApiOperation({ summary: 'Envia código de acesso por SMS ou e-mail (ficha 06)' })
  @ApiErrors(400, 403, 404, 429, 503)
  requestCode(@Body() dto: OtpRequestDto, @ClientMeta() meta: RequestMeta): Promise<OtpChallengeDto> {
    return this.auth.requestLoginCode(dto.channel, dto.destination, meta.ipAddress);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ApiOperation({ summary: 'Confere o código e abre a sessão' })
  @ApiErrors(400, 403, 429)
  async verifyCode(@Body() dto: OtpVerifyDto, @ClientMeta() meta: RequestMeta, @Res({ passthrough: true }) response: Response): Promise<MeResponseDto> {
    return this.startSession(await this.auth.verifyLoginCode(dto.challengeId, dto.code), meta, response);
  }

  @Public()
  @Post('password-reset')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @ApiOperation({ summary: 'Envia o código de recuperação de senha (ficha 44); resposta igual para contas inexistentes' })
  @ApiErrors(400, 429, 503)
  requestPasswordReset(@Body() dto: PasswordResetRequestDto, @ClientMeta() meta: RequestMeta): Promise<OtpChallengeDto> {
    return this.auth.requestPasswordReset(dto.channel, dto.destination, meta.ipAddress);
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ApiOperation({ summary: 'Confere o código (uso único, 10 min) e define a nova senha; encerra todas as sessões (ficha 44)' })
  @ApiErrors(400, 429)
  async confirmPasswordReset(@Body() dto: PasswordResetConfirmDto) {
    await this.auth.confirmPasswordReset(dto.challengeId, dto.code, dto.newPassword);
  }

  @Public()
  @Post('refresh')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: MINUTE } })
  @ApiOperation({ summary: 'Renova a sessão (rotação do refresh token em cookie HttpOnly)' })
  @ApiErrors(401, 403)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token: unknown = request.cookies?.[REFRESH_COOKIE];
    try {
      if (typeof token !== 'string' || !token) throw new AppError(401, 'SESSION_EXPIRED', 'Sua sessão expirou. Entre novamente.');
      setSessionCookies(response, await this.sessions.refresh(token), this.config);
    } catch (error) {
      clearSessionCookies(response, this.config);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Encerra a sessão deste aparelho' })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token: unknown = request.cookies?.[REFRESH_COOKIE];
    const sessionId = request.auth?.sessionId ?? (typeof token === 'string' ? (await this.sessions.findIdByRefreshToken(token))?.id : undefined);
    if (sessionId) await this.sessions.revoke(sessionId, 'logout');
    clearSessionCookies(response, this.config);
  }

  @Post('logout-all')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Encerra todas as sessões da conta (todos os aparelhos)' })
  @ApiErrors(401)
  async logoutAll(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) response: Response) {
    await this.sessions.revokeAllForUser(auth.userId, 'logout_all');
    clearSessionCookies(response, this.config);
  }

  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'Quais logins sociais estão configurados neste ambiente' })
  providers(): AuthProvidersDto {
    return { ...this.oauth.status(), codeChannels: this.auth.codeChannels(), paymentProvider: this.config.env.PAYMENT_PROVIDER };
  }

  @Post('verify-contact')
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Envia o código de verificação para o e-mail ou celular da conta logada (ficha 65)' })
  @ApiErrors(401, 409, 422, 429, 503)
  requestContactVerification(@CurrentAuth() auth: AuthContext, @Body() dto: ContactVerificationRequestDto, @ClientMeta() meta: RequestMeta): Promise<OtpChallengeDto> {
    return this.auth.requestContactVerification(auth.userId, dto.channel, meta.ipAddress);
  }

  @Post('verify-contact/confirm')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Confere o código e grava o contato como verificado (ficha 65)' })
  @ApiErrors(400, 401, 429)
  async confirmContactVerification(@CurrentAuth() auth: AuthContext, @Body() dto: ContactVerificationConfirmDto): Promise<MeResponseDto> {
    await this.auth.confirmContactVerification(auth.userId, dto.challengeId, dto.code);
    return this.me.getMe(auth.userId);
  }

  @Public()
  @Get('oauth/:provider')
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ApiOperation({ summary: 'Inicia o login com Google ou Apple (redireciona para o provedor)' })
  @ApiErrors(503)
  async startOAuth(@Param('provider', providerPipe) provider: OAuthProviderId, @Res() response: Response) {
    response.redirect((await this.oauth.start(provider)).href);
  }

  @Public()
  @Get('oauth/:provider/callback')
  @ApiExcludeEndpoint()
  async oauthCallbackGet(
    @Param('provider', providerPipe) provider: OAuthProviderId,
    @Query('state') state: unknown,
    @Query('error') error: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const current = new URL(request.originalUrl, this.oauth.redirectUri(provider));
    await this.finishOAuth(provider, state, error, current, null, request, response);
  }

  /** A Apple devolve via POST (form_post) a partir do domínio dela: protegido por state + PKCE, não pelo header anti-CSRF. */
  @Public()
  @SkipCsrf()
  @Post('oauth/:provider/callback')
  @ApiExcludeEndpoint()
  async oauthCallbackPost(@Param('provider', providerPipe) provider: OAuthProviderId, @Req() request: Request, @Res() response: Response) {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const form = new URLSearchParams(Object.entries(body).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    const current = new Request(this.oauth.redirectUri(provider), {
      method: 'POST',
      body: form,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    await this.finishOAuth(provider, body.state, body.error, current, appleName(body.user), request, response);
  }

  private async finishOAuth(
    provider: OAuthProviderId,
    state: unknown,
    error: unknown,
    current: URL | globalThis.Request,
    fallbackName: string | null,
    request: Request,
    response: Response,
  ) {
    const back = new URL(this.config.env.WEB_ORIGIN);
    try {
      if (error) throw new AppError(400, 'OAUTH_CANCELLED', 'Login cancelado.');
      if (typeof state !== 'string' || !state) throw new AppError(400, 'OAUTH_STATE_INVALID', 'Login expirado.');
      const userId = await this.oauth.complete(provider, state, current, fallbackName);
      const session = await this.sessions.create(userId, { userAgent: request.get('user-agent'), ipAddress: request.ip });
      setSessionCookies(response, session, this.config);
      back.searchParams.set('auth', 'success');
    } catch (failure) {
      const code = failure instanceof AppError ? failure.code : 'OAUTH_FAILED';
      if (!(failure instanceof AppError)) this.logger.warn(`Falha no login com ${provider}: ${failure instanceof Error ? failure.message : 'erro desconhecido'}`);
      back.searchParams.set('auth_error', code.toLowerCase());
    }
    response.redirect(back.href);
  }
}

/** A Apple só envia o nome no primeiro login, num campo `user` em JSON. */
function appleName(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_APPLE_USER_PAYLOAD) return null;
  try {
    const parsed = JSON.parse(raw) as { name?: { firstName?: unknown; lastName?: unknown } };
    const parts = [parsed.name?.firstName, parsed.name?.lastName].filter((part): part is string => typeof part === 'string');
    return parts.join(' ').trim() || null;
  } catch {
    return null;
  }
}
