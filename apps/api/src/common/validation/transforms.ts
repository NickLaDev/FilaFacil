import { Transform } from 'class-transformer';

/** Remove espaços nas pontas de strings recebidas (antes da validação). */
export const Trim = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** Converte "true"/"false" de query string em boolean. */
export const ToBoolean = () =>
  Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value));

/** Converte query string numérica em number (mantém o valor original se não for numérico, para a validação acusar). */
export const ToNumber = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : value));

/** Aceita lista repetida (?a=1&a=2) ou separada por vírgula (?a=1,2); descarta itens vazios. */
export const ToList = () =>
  Transform(({ value }: { value: unknown }) => {
    const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
    return parts ? parts.map(part => (typeof part === 'string' ? part.trim() : part)).filter(part => part !== '') : value;
  });
