import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CLIENT_HEADER } from '@filafacil/shared';
import { forbidden } from '../http/app-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SKIP_CSRF = 'skipCsrf';

/** Para rotas chamadas por terceiros (ex.: callback form_post da Apple), protegidas por outro mecanismo. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

/**
 * Defesa contra CSRF nas rotas autenticadas por cookie: métodos que alteram estado exigem um header
 * customizado. Um site de terceiros não consegue enviá-lo sem passar pelo preflight do CORS,
 * que só aceita a origem do frontend. Soma-se ao SameSite=Lax dos cookies.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [context.getHandler(), context.getClass()])) return true;
    if (request.get(CLIENT_HEADER.name)) return true;
    throw forbidden('CSRF_HEADER_MISSING', 'Requisição bloqueada por segurança.');
  }
}
