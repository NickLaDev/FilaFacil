import { onlyDigits } from '@filafacil/shared';

// Regras de validação compartilhadas com a API (a API sempre revalida no servidor).
export { isStrongPassword, isValidCpf, isValidEmail, isValidPhone, maskCpf, onlyDigits, PASSWORD_RULES } from '@filafacil/shared';

export function formatCpf(value: string) {
  return onlyDigits(value)
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function formatPhone(value: string) {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

/** Só aceita imagens https, enviadas à API (/api/uploads) ou data:image — bloqueia esquemas como javascript:. */
export function isSafeImageSrc(value: string) {
  return (
    /^https:\/\/\S+$/i.test(value) ||
    /^\/api\/uploads\/[a-f0-9]{32}\.webp$/.test(value) ||
    /^data:image\/(png|jpe?g|webp|gif);base64,[\w+/=]+$/i.test(value)
  );
}

/** Algoritmo de Luhn — barra números de cartão digitados errado antes de ir ao gateway. */
export function isValidCardNumber(value: string) {
  const digits = onlyDigits(value);
  if (digits.length < 13 || digits.length > 19) return false;
  const sum = digits
    .split('')
    .reverse()
    .reduce((acc, char, index) => {
      let digit = Number(char);
      if (index % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      return acc + digit;
    }, 0);
  return sum % 10 === 0;
}

export function formatCardNumber(value: string) {
  return onlyDigits(value).slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function formatCardExpiry(value: string) {
  const digits = onlyDigits(value).slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

/** Validade MM/AA ainda não vencida em relação a `now`. */
export function isValidCardExpiry(value: string, now: Date) {
  const match = /^(\d{2})\/(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return false;
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
}
