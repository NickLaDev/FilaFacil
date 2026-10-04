/**
 * IDs fixos do seed de desenvolvimento da API (apps/api/prisma/seed.ts). Só os mocks da
 * Sprint 2 (pedidos, QR Code e status das mesas) os referenciam, até ganharem backend próprio.
 */
const id = (namespace: number, n: number) => `${String(namespace).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const SEED_IDS = {
  establishments: { barDoMestre: id(1, 1), cantina: id(1, 3), botecoDaVila: id(1, 4), barDoMestreExpress: id(1, 8) },
  users: { joao: id(5, 10) },
  items: { comboIpa: id(6, 7), choppPilsen: id(6, 10), batataCheddar: id(6, 12) },
  table: (n: number) => id(2, n),
};
