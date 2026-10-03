import type { Order } from '@/types/order';
import type { WaitlistEntry } from '@/types/waitlist';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** Histórico do cliente demo. Pedidos novos são criados pelo fluxo de checkout. */
export const ORDERS: Order[] = [
  {
    id: 'o-167', number: 167, accountId: 'acc-demo', establishmentId: 'r4', establishmentName: 'Boteco da Vila',
    tableLabel: 'Mesa 3', pickupPoint: 'Balcão', pickupCode: '5810', paymentMethod: 'pix', transactionId: 'PIX-8F21C0',
    lines: [
      { menuItemId: 'b1', name: 'Chopp Pilsen 300ml', quantity: 2, unitPrice: 9.9, notes: '' },
      { menuItemId: 'b3', name: 'Batata com Cheddar', quantity: 1, unitPrice: 27, notes: '' },
    ],
    total: 46.8, createdAt: ago(5 * DAY), completed: true,
  },
  {
    id: 'o-152', number: 152, accountId: 'acc-demo', establishmentId: 'r1', establishmentName: 'Bar do Mestre',
    tableLabel: 'Mesa 7', pickupPoint: 'Balcão 2', pickupCode: '2219', paymentMethod: 'credit', transactionId: 'CARD-41A9D2',
    lines: [{ menuItemId: 'm7', name: 'Combo IPA + X-Burger', quantity: 2, unitPrice: 42, notes: '' }],
    total: 84, createdAt: ago(12 * DAY), completed: true,
  },
];

export const WAITLIST: WaitlistEntry[] = [
  { id: 'w1', establishmentId: 'r1', name: 'Lucas Torres', phone: '(19) 99874-1234', partySize: 4, joinedAt: ago(19 * MINUTE), status: 'waiting' },
  { id: 'w2', establishmentId: 'r1', name: 'Marina Silva', phone: '(19) 98765-4321', partySize: 2, joinedAt: ago(14 * MINUTE), status: 'waiting' },
  { id: 'w3', establishmentId: 'r1', name: 'João Mendes', phone: '(19) 97654-3210', partySize: 6, joinedAt: ago(6 * MINUTE), status: 'waiting' },
];
