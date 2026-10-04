export const onlyDigits = (value: string) => value.replace(/\D/g, '');

/** CPF com dígitos verificadores válidos (rejeita sequências repetidas como 111.111.111-11). */
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

/** Exibe só o final do CPF — o documento completo nunca precisa sair do backend. */
export function maskCpf(value: string) {
  const cpf = onlyDigits(value);
  return `***.***.${cpf.slice(6, 9)}-${cpf.slice(9, 11)}`;
}

export const EMAIL_MAX_LENGTH = 254;

export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export function isValidEmail(value: string) {
  const email = value.trim();
  return email.length <= EMAIL_MAX_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** Celular/telefone brasileiro com DDD, guardado só com dígitos (10 ou 11). */
export const normalizePhone = (value: string) => onlyDigits(value);

export function isValidPhone(value: string) {
  const length = onlyDigits(value).length;
  return length === 10 || length === 11;
}

export const PASSWORD_MIN_LENGTH = 8;
/** Teto evita hashes caros de propósito (DoS) sem atrapalhar gerenciadores de senha. */
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_RULES = [
  { label: `Mínimo ${PASSWORD_MIN_LENGTH} caracteres`, test: (password: string) => password.length >= PASSWORD_MIN_LENGTH },
  { label: 'Letra', test: (password: string) => /[a-zA-Z]/.test(password) },
  { label: 'Número', test: (password: string) => /\d/.test(password) },
];

export const isStrongPassword = (password: string) =>
  password.length <= PASSWORD_MAX_LENGTH && PASSWORD_RULES.every(rule => rule.test(password));
