import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Cookie que identifica o aparelho (ficha 52): só o SHA-256 dele é guardado no banco. */
export const DEVICE_COOKIE = 'ff_device';
const DEVICE_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

const storage = new AsyncLocalStorage<{ request: Request }>();

/** Requisição HTTP em andamento (para auditoria e log de acesso sem passar o contexto por todas as camadas). */
export const currentRequest = (): Request | undefined => storage.getStore()?.request;

/**
 * Guarda a requisição no contexto assíncrono e, nas rotas de autenticação, garante o cookie do aparelho
 * (HttpOnly, aleatório): é ele que diz se um login vem de um dispositivo já conhecido.
 */
export function requestContextMiddleware(secureCookie: boolean) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (request.path.startsWith('/api/auth') && typeof request.cookies?.[DEVICE_COOKIE] !== 'string') {
      const deviceId = randomBytes(24).toString('base64url');
      response.cookie(DEVICE_COOKIE, deviceId, { httpOnly: true, sameSite: 'lax', secure: secureCookie, path: '/api', maxAge: DEVICE_COOKIE_MAX_AGE_MS });
      request.cookies = { ...(request.cookies ?? {}), [DEVICE_COOKIE]: deviceId };
    }
    storage.run({ request }, () => next());
  };
}

/** Como o usuário entrou, pela rota que criou a sessão. */
export function loginMethodFor(path: string | undefined): string {
  if (!path) return 'other';
  if (path.endsWith('/auth/login')) return 'password';
  if (path.endsWith('/auth/otp/verify')) return 'code';
  if (path.endsWith('/auth/register')) return 'signup';
  if (path.includes('/oauth/google')) return 'google';
  if (path.includes('/oauth/apple')) return 'apple';
  if (path.includes('/webauthn')) return 'passkey';
  return 'other';
}
