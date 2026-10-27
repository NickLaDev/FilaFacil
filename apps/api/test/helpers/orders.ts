import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/database/prisma.service.js';
import { createUser, login, type World } from './fixtures.js';
import type { Agent } from './test-app.js';

/** Planta com uma mesa em cada bar de teste; devolve também um segundo cliente (sem relação com o primeiro). */
export async function createOrdersWorld(prisma: PrismaService, world: World) {
  const planA = await prisma.floorPlan.create({ data: { establishmentId: world.estA.id } });
  const planB = await prisma.floorPlan.create({ data: { establishmentId: world.estB.id } });
  const tableA = await prisma.diningTable.create({
    data: { floorPlanId: planA.id, establishmentId: world.estA.id, label: 'Mesa 1', shape: 'square', capacity: 4, positionX: 10, positionY: 10, qrCode: 'BARA-1111' },
  });
  const tableB = await prisma.diningTable.create({
    data: { floorPlanId: planB.id, establishmentId: world.estB.id, label: 'Mesa 9', shape: 'square', capacity: 4, positionX: 10, positionY: 10, qrCode: 'BARB-2222' },
  });
  const otherClient = await createUser(prisma, { name: 'Outro Cliente', email: 'outro@test.dev', role: 'client' });
  return { tableA, tableB, otherClient };
}

/** Marca o e-mail da conta como verificado direto no banco (a verificação em si é testada à parte). */
export const verifyEmail = (prisma: PrismaService, userId: string) =>
  prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });

export interface OrderBody {
  establishmentId: string;
  tableId?: string;
  items: { menuItemId: string; quantity: number; notes?: string }[];
  expectedTotalCents?: number;
  redeemPoints?: number;
  clientRequestId?: string;
}

export async function placeOrder(agent: Agent, body: OrderBody, csrf: Record<string, string>) {
  return agent.post('/api/orders').set(csrf).send({ clientRequestId: randomUUID(), ...body });
}

export { login };

export interface SeedOrder {
  userId: string;
  establishmentId: string;
  status?: 'received' | 'paid' | 'preparing' | 'ready' | 'delivered' | 'cancelled';
  tableId?: string | null;
  /** Aprovado no gateway fictício (linha `payments` aprovada, com id de provedor). */
  withPayment?: boolean;
  paidAt?: Date;
  items: { menuItemId: string; name: string; unitPriceCents: number; quantity?: number; stationId?: string | null }[];
  data?: Record<string, unknown>;
}

/** Cria um pedido direto no banco (estado já avançado), sem passar pelo gateway. */
export async function seedOrder(prisma: PrismaService, input: SeedOrder) {
  const status = input.status ?? 'paid';
  const total = input.items.reduce((sum, item) => sum + item.unitPriceCents * (item.quantity ?? 1), 0);
  const paid = status !== 'received' && input.withPayment !== false;
  const order = await prisma.order.create({
    data: {
      userId: input.userId,
      establishmentId: input.establishmentId,
      tableId: input.tableId ?? null,
      status,
      totalCents: total,
      pickupCode: '1234',
      paidAt: paid ? (input.paidAt ?? new Date()) : null,
      items: { create: input.items.map(item => ({ menuItemId: item.menuItemId, name: item.name, unitPriceCents: item.unitPriceCents, quantity: item.quantity ?? 1, stationId: item.stationId ?? null })) },
      ...(input.data as object),
    },
  });
  if (paid) {
    await prisma.payment.create({
      data: { orderId: order.id, attempt: 1, method: 'credit', status: 'approved', amountCents: total, providerPaymentId: `seed-${order.id}`, approvedAt: input.paidAt ?? new Date() },
    });
  }
  return order;
}
