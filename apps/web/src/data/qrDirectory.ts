import { SEED_IDS } from './seedIds';

/**
 * Sprint 2 (ficha 02 — QR Code para pedido) ainda sem API: o leitor resolve os códigos do seed
 * por este diretório local. Mesas criadas depois na planta ganham código no servidor, mas só
 * passam a ser lidas pelo app quando o backend do QR Code existir.
 */
const table = (n: number, label: string) => ({ tableId: SEED_IDS.table(n), tableLabel: label });

export const QR_DIRECTORY: Record<string, { establishmentId: string; tableId: string; tableLabel: string }> = {
  ...Object.fromEntries(
    [1041, 2087, 3112, 4250, 5379, 6403, 7531, 8664, 9718, 1095, 1126, 1283].map((code, index) => [
      `MESTRE-${code}`,
      { establishmentId: SEED_IDS.establishments.barDoMestre, ...table(index + 1, `Mesa ${index + 1}`) },
    ]),
  ),
  'CANTINA-1201': { establishmentId: SEED_IDS.establishments.cantina, ...table(21, 'Mesa 1') },
  'CANTINA-2302': { establishmentId: SEED_IDS.establishments.cantina, ...table(22, 'Mesa 2') },
};

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** Status que só o mapa da Sprint 2 conhece (reservada/chamado), aplicados sobre a ocupação real. */
export const SEED_TABLE_OVERLAYS = {
  [SEED_IDS.table(4)]: { status: 'reserved' as const, people: 2, since: minutesAgo(5) },
  [SEED_IDS.table(6)]: { status: 'called' as const, people: 3, since: minutesAgo(55) },
  [SEED_IDS.table(11)]: { status: 'reserved' as const, people: 6, since: minutesAgo(3) },
};
