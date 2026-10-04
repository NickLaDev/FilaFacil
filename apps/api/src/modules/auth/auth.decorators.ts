import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { unauthorized } from '../../common/http/app-error.js';
import type { AuthContext, RequestMeta } from './auth.types.js';

export const IS_PUBLIC = 'isPublic';

/** Rota acessível sem login (se houver sessão válida, `request.auth` ainda é preenchido). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentAuth = createParamDecorator((_: unknown, context: ExecutionContext): AuthContext => {
  const auth = context.switchToHttp().getRequest<Request>().auth;
  if (!auth) throw unauthorized('AUTH_REQUIRED', 'Faça login para continuar.');
  return auth;
});

export const ClientMeta = createParamDecorator((_: unknown, context: ExecutionContext): RequestMeta => {
  const request = context.switchToHttp().getRequest<Request>();
  return { userAgent: request.get('user-agent'), ipAddress: request.ip };
});
