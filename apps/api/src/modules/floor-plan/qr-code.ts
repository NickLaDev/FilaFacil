import { randomInt } from 'node:crypto';

/** Prefixo legível a partir do nome (ex.: "Bar do Mestre" → "MESTRE"). */
export function qrPrefixFromName(name: string) {
  const words = name
    .normalize('NFD')
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2 && !/^\d+$/.test(word));
  return (words.at(-1) ?? 'MESA').toUpperCase().slice(0, 8);
}

export const randomQrCode = (prefix: string) => `${prefix}-${randomInt(1000, 10_000)}`;
