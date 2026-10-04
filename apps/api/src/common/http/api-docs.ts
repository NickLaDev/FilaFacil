import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiResponse } from '@nestjs/swagger';
import type { ApiErrorBody, ApiFieldError } from '@filafacil/shared';

export class ApiFieldErrorDto implements ApiFieldError {
  field!: string;
  message!: string;
}

export class ApiErrorDto implements ApiErrorBody {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ example: 'VALIDATION_FAILED', description: 'Código estável para o frontend decidir o fluxo.' })
  code!: string;

  @ApiProperty({ example: 'Dados inválidos.' })
  message!: string;

  @ApiProperty({ type: [ApiFieldErrorDto], required: false })
  details?: ApiFieldErrorDto[];
}

const DESCRIPTIONS: Record<number, string> = {
  400: 'Dados inválidos (VALIDATION_FAILED, INVALID_JSON…)',
  401: 'Sem sessão válida (AUTH_REQUIRED, ACCESS_TOKEN_EXPIRED, SESSION_EXPIRED…)',
  403: 'Sem permissão (FORBIDDEN, MISSING_PERMISSION, FEATURE_NOT_IN_PLAN, ACCOUNT_SUSPENDED, CSRF_HEADER_MISSING…)',
  404: 'Recurso não encontrado ou fora do seu acesso',
  409: 'Conflito com dados existentes',
  413: 'Conteúdo maior que o permitido',
  422: 'Regra de negócio violada',
  429: 'Muitas tentativas',
  503: 'Dependência externa não configurada',
};

/** Documenta as respostas de erro padronizadas de uma rota. */
export const ApiErrors = (...statuses: number[]) =>
  applyDecorators(...statuses.map(status => ApiResponse({ status, description: DESCRIPTIONS[status], type: ApiErrorDto })));
