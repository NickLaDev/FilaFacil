import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiFieldError } from '@filafacil/shared';

/** Erro de negócio com código estável (o frontend decide a mensagem/fluxo pelo `code`). */
export class AppError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: ApiFieldError[],
  ) {
    super({ code, message, details }, status);
  }
}

export const badRequest = (code: string, message: string, details?: ApiFieldError[]) =>
  new AppError(HttpStatus.BAD_REQUEST, code, message, details);
export const unauthorized = (code: string, message: string) => new AppError(HttpStatus.UNAUTHORIZED, code, message);
export const forbidden = (code: string, message: string) => new AppError(HttpStatus.FORBIDDEN, code, message);
export const notFound = (message = 'Recurso não encontrado.') => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', message);
export const conflict = (code: string, message: string, details?: ApiFieldError[]) =>
  new AppError(HttpStatus.CONFLICT, code, message, details);
export const unprocessable = (code: string, message: string, details?: ApiFieldError[]) =>
  new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
export const tooManyRequests = (code: string, message: string) => new AppError(HttpStatus.TOO_MANY_REQUESTS, code, message);
export const serviceUnavailable = (code: string, message: string) => new AppError(HttpStatus.SERVICE_UNAVAILABLE, code, message);
