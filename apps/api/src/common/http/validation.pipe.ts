import { ValidationPipe, type ValidationError } from '@nestjs/common';
import type { ApiFieldError } from '@filafacil/shared';
import { badRequest } from './app-error.js';

function flatten(errors: ValidationError[], parent = ''): ApiFieldError[] {
  return errors.flatMap(error => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map(message => ({ field, message }));
    return [...own, ...flatten(error.children ?? [], field)];
  });
}

/** DTO whitelist: propriedades desconhecidas são rejeitadas e os tipos são convertidos explicitamente. */
export const createValidationPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    validationError: { target: false, value: false },
    exceptionFactory: errors => badRequest('VALIDATION_FAILED', 'Dados inválidos.', flatten(errors)),
  });
