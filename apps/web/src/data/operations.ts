import type { Order } from '@/types/order';
import { SEED_IDS } from './seedIds';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/**
 * Sprint 2 (pedidos) ainda é simulada: histórico do cliente demo do seed da API (João Silva).
 * Pedidos novos são criados pelo fluxo de checkout e ficam no navegador.
 */
export const ORDERS: Order[] = [
  {
    id: 'o-167', number: 167, accountId: SEED_IDS.users.joao, establishmentId: SEED_IDS.establishments.botecoDaVila, establishmentName: 'Boteco da Vila',
    tableLabel: 'Mesa 3', pickupPoint: 'Balcão', pickupCode: '5810', paymentMethod: 'pix', transactionId: 'PIX-8F21C0',
    lines: [
      { menuItemId: SEED_IDS.items.choppPilsen, name: 'Chopp Pilsen 300ml', quantity: 2, unitPrice: 9.9, notes: '' },
      { menuItemId: SEED_IDS.items.batataCheddar, name: 'Batata com Cheddar', quantity: 1, unitPrice: 27, notes: '' },
    ],
    total: 46.8, createdAt: ago(5 * DAY), completed: true,
  },
  {
    id: 'o-152', number: 152, accountId: SEED_IDS.users.joao, establishmentId: SEED_IDS.establishments.barDoMestre, establishmentName: 'Bar do Mestre',
    tableLabel: 'Mesa 7', pickupPoint: 'Balcão 2', pickupCode: '2219', paymentMethod: 'credit', transactionId: 'CARD-41A9D2',
    lines: [{ menuItemId: SEED_IDS.items.comboIpa, name: 'Combo IPA + X-Burger', quantity: 2, unitPrice: 42, notes: '' }],
    total: 84, createdAt: ago(12 * DAY), completed: true,
  },
];
