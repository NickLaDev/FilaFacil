import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import type { ApiErrorBody } from '@filafacil/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from './app-error.js';

const STATUS_CODES: Partial<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
};

/**
 * Formato único de erro ({ statusCode, code, message, details? }). Nada de stack trace,
 * SQL ou mensagem interna vai para o cliente: falhas inesperadas viram 500 genérico e só o log as detalha.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return;
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (response.headersSent) return;
    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiErrorBody {
    if (exception instanceof AppError) {
      return { statusCode: exception.getStatus(), code: exception.code, message: exception.message, details: exception.details };
    }
    if (exception instanceof ThrottlerException) {
      return { statusCode: 429, code: 'TOO_MANY_REQUESTS', message: 'Muitas tentativas. Aguarde um pouco e tente de novo.' };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { statusCode: status, code: STATUS_CODES[status] ?? 'HTTP_ERROR', message: this.publicMessage(exception, status) };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = this.fromPrisma(exception);
      if (mapped) return mapped;
    }
    const bodyParserError = this.fromBodyParser(exception);
    if (bodyParserError) return bodyParserError;

    this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Erro inesperado. Tente novamente em instantes.' };
  }

  private publicMessage(exception: HttpException, status: number) {
    if (status >= 500) return 'Erro inesperado. Tente novamente em instantes.';
    const response = exception.getResponse();
    const message = typeof response === 'object' && response && 'message' in response ? response.message : exception.message;
    return typeof message === 'string' ? message : 'Requisição inválida.';
  }

  private fromPrisma(error: Prisma.PrismaClientKnownRequestError): ApiErrorBody | null {
    if (error.code === 'P2002') return { statusCode: 409, code: 'CONFLICT', message: 'Já existe um registro com esses dados.' };
    if (error.code === 'P2025') return { statusCode: 404, code: 'NOT_FOUND', message: 'Recurso não encontrado.' };
    if (error.code === 'P2003') return { statusCode: 409, code: 'CONFLICT', message: 'O registro está vinculado a outros dados.' };
    return null;
  }

  /** Erros do body-parser do Express (JSON malformado, payload acima do limite). */
  private fromBodyParser(error: unknown): ApiErrorBody | null {
    if (typeof error !== 'object' || error === null || !('type' in error)) return null;
    if (error.type === 'entity.too.large') return { statusCode: HttpStatus.PAYLOAD_TOO_LARGE, code: 'PAYLOAD_TOO_LARGE', message: 'Conteúdo maior que o permitido.' };
    if (error.type === 'entity.parse.failed') return { statusCode: HttpStatus.BAD_REQUEST, code: 'INVALID_JSON', message: 'JSON inválido.' };
    return null;
  }
}
