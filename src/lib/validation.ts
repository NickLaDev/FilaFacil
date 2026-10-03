export const onlyDigits = (value: string) => value.replace(/\D/g, '');

export function isValidCpf(value: string) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const checkDigit = (length: number) => {
    const sum = cpf
      .slice(0, length)
      .split('')
      .reduce((acc, digit, index) => acc + Number(digit) * (length + 1 - index), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return checkDigit(9) === Number(cpf[9]) && checkDigit(10) === Number(cpf[10]);
}

export function formatCpf(value: string) {
  return onlyDigits(value)
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

/** Exibe só o final do CPF — o documento completo nunca fica salvo no cliente. */
export function maskCpf(value: string) {
  const cpf = onlyDigits(value);
  return `***.***.${cpf.slice(6, 9)}-${cpf.slice(9, 11)}`;
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function formatPhone(value: string) {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function isValidPhone(value: string) {
  const length = onlyDigits(value).length;
  return length === 10 || length === 11;
}

export const PASSWORD_RULES = [
  { label: 'Mínimo 8 caracteres', test: (password: string) => password.length >= 8 },
  { label: 'Letra', test: (password: string) => /[a-zA-Z]/.test(password) },
  { label: 'Número', test: (password: string) => /\d/.test(password) },
];

export const isStrongPassword = (password: string) => PASSWORD_RULES.every(rule => rule.test(password));

/** Só aceita imagens https ou data:image — bloqueia esquemas como javascript:. */
export function isSafeImageSrc(value: string) {
  return /^https:\/\/\S+$/i.test(value) || /^data:image\/(png|jpe?g|webp|gif);base64,[\w+/=]+$/i.test(value);
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
