import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { unauthorized } from '../../common/http/app-error.js';
import { ACCESS_COOKIE } from './auth-cookies.js';
import { IS_PUBLIC } from './auth.decorators.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

/**
 * Guard global: toda rota exige sessão válida, exceto as marcadas com @Public().
 * Em rotas públicas a sessão é opcional e falhas de autenticação são ignoradas.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    const token: unknown = request.cookies?.[ACCESS_COOKIE];

    if (typeof token !== 'string' || !token) {
      if (isPublic) return true;
      throw unauthorized('AUTH_REQUIRED', 'Faça login para continuar.');
    }
    const payload = await this.tokens.verifyAccessToken(token);
    if (!payload) {
      if (isPublic) return true;
      throw unauthorized('ACCESS_TOKEN_EXPIRED', 'Sessão expirada.');
    }
    try {
      request.auth = await this.sessions.authenticate(payload);
    } catch (error) {
      if (!isPublic) throw error;
    }
    return true;
  }
}
