import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

export const hmacSha256Hex = (secret: string, value: string) => createHmac('sha256', secret).update(value).digest('hex');

/** Token opaco com entropia suficiente para refresh tokens, state de OAuth etc. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Comparação em tempo constante de dois hex de mesmo tamanho. */
export function safeEqualHex(a: string, b: string) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
