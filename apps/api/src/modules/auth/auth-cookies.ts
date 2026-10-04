import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../../config/app-config.js';
import type { IssuedSession } from './session.service.js';

export const ACCESS_COOKIE = 'ff_access';
export const REFRESH_COOKIE = 'ff_refresh';

// O refresh token só viaja para as rotas de autenticação; o access token, para toda a API.
const ACCESS_PATH = '/api';
const REFRESH_PATH = '/api/auth';

const baseOptions = (config: AppConfig): CookieOptions => ({
  httpOnly: true,
  secure: config.env.COOKIE_SECURE,
  sameSite: 'lax',
});

export function setSessionCookies(response: Response, session: IssuedSession, config: AppConfig) {
  const options = baseOptions(config);
  response.cookie(ACCESS_COOKIE, session.accessToken, {
    ...options,
    path: ACCESS_PATH,
    maxAge: config.env.ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  response.cookie(REFRESH_COOKIE, session.refreshToken, {
    ...options,
    path: REFRESH_PATH,
    maxAge: config.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookies(response: Response, config: AppConfig) {
  const options = baseOptions(config);
  response.clearCookie(ACCESS_COOKIE, { ...options, path: ACCESS_PATH });
  response.clearCookie(REFRESH_COOKIE, { ...options, path: REFRESH_PATH });
}
