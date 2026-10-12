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
  clientRequestId?: string;
}

export async function placeOrder(agent: Agent, body: OrderBody, csrf: Record<string, string>) {
  return agent.post('/api/orders').set(csrf).send({ clientRequestId: randomUUID(), ...body });
}

export { login };
