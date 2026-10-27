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

/**
 * Celular brasileiro em E.164 (+55 + DDD + número) para provedores de SMS. Aceita só dígitos, com ou sem o
 * código do país (55). DDD de 11 a 99; 11 dígitos exigem o 9 inicial (celular); 10 dígitos = fixo/legado.
 * Devolve `null` quando o número não é brasileiro válido — nunca "adivinha" outro país.
 */
export function toE164Br(value: string): string | null {
  let digits = onlyDigits(value);
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length !== 10 && digits.length !== 11) return null;
  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99 || digits[1] === '0') return null;
  if (digits.length === 11 && digits[2] !== '9') return null;
  if (digits.length === 10 && !/[2-5]/.test(digits[2] ?? '')) return null;
  return `+55${digits}`;
}

// ─── FilaZero Club (ficha 14) ───────────────────────────────────────────────

/** 1 ponto por R$ 1,00 líquido pago (centavos/100, truncado). */
export const LOYALTY_CENTS_PER_POINT = 100;
/** Resgate em blocos: 100 pontos valem R$ 5,00 de desconto. */
export const LOYALTY_REDEEM_BLOCK_POINTS = 100;
export const LOYALTY_REDEEM_BLOCK_CENTS = 500;
/** O total líquido do pedido nunca fica abaixo de R$ 1,00 (o gateway não cobra valor zero). */
export const LOYALTY_MIN_NET_CENTS = 100;

export const pointsEarnedForCents = (netCents: number) => (netCents > 0 ? Math.floor(netCents / LOYALTY_CENTS_PER_POINT) : 0);

export const discountForPoints = (points: number) => (points / LOYALTY_REDEEM_BLOCK_POINTS) * LOYALTY_REDEEM_BLOCK_CENTS;

/** Maior resgate (em pontos, múltiplo de 100) permitido para o saldo e o subtotal do pedido. */
export function maxRedeemablePoints(balancePoints: number, subtotalCents: number) {
  const byBalance = Math.floor(Math.max(balancePoints, 0) / LOYALTY_REDEEM_BLOCK_POINTS);
  const byTotal = Math.floor(Math.max(subtotalCents - LOYALTY_MIN_NET_CENTS, 0) / LOYALTY_REDEEM_BLOCK_CENTS);
  return Math.min(byBalance, byTotal) * LOYALTY_REDEEM_BLOCK_POINTS;
}

// ─── Operação (Sprint 3) ────────────────────────────────────────────────────

/** Sem sinal da impressora por este tempo = offline (ficha 26). */
export const PRINTER_OFFLINE_AFTER_MS = 60_000;
export const ESTIMATE_MIN_MINUTES = 1;
export const ESTIMATE_MAX_MINUTES = 240;
