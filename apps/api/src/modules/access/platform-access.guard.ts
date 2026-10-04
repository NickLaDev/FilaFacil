import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Permission } from '@filafacil/shared';
import { forbidden, unauthorized } from '../../common/http/app-error.js';
import { PLATFORM_PERMISSION } from './access.constants.js';

/** Rotas /admin: exige papel admin e a permissão de plataforma correspondente. */
@Injectable()
export class PlatformAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PLATFORM_PERMISSION, [context.getHandler(), context.getClass()]);
    const auth = request.auth;
    if (!auth) throw unauthorized('AUTH_REQUIRED', 'Faça login para continuar.');
    if (auth.role !== 'admin') throw forbidden('ADMIN_ONLY', 'Área exclusiva da administração da plataforma.');
    if (permission && !auth.permissions.has(permission)) throw forbidden('MISSING_PERMISSION', 'Seu usuário não tem permissão para esta ação.');
    return true;
  }
}
