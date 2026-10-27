import { io, type Socket } from 'socket.io-client';
import { PERMISSIONS, REALTIME_EVENTS, ROLE_DEFAULT_PERMISSIONS } from '@filafacil/shared';
import { resetDatabase } from '../helpers/database.js';
import { createWorld, PASSWORD, login, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, seedOrder, verifyEmail } from '../helpers/orders.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

describe('Sprint 3 — chamado, posição na fila, onboarding e dashboard (fichas 18, 51, 07, 27)', () => {
  let t: TestApp;
  let world: World;
  let tableId: string;
  let client: Agent;
  let manager: Agent;
  let attendant: Agent;
  const sockets: Socket[] = [];
  const base = () => `/api/establishments/${world.estA.id}`;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  afterEach(() => sockets.splice(0).forEach(socket => socket.close()));
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    tableId = (await createOrdersWorld(t.prisma, world)).tableA.id;
    await verifyEmail(t.prisma, world.client.id);
    client = await login(t.browser(), world.client.email);
    manager = await login(t.browser(), world.managerA.email);
    attendant = await login(t.browser(), world.attendantA.email);
  });

  async function connect(email: string | null, subscribe?: object) {
    if (!email) throw new Error('Usuário de teste sem e-mail.');
    const response = await t.browser().post('/api/auth/login').set(CSRF).send({ email, password: PASSWORD });
    const cookie = ([] as string[]).concat(response.headers['set-cookie'] ?? []).map(c => c.split(';')[0]).join('; ');
    const socket = io(`http://localhost:${t.port}/realtime`, { path: '/api/socket.io', transports: ['websocket'], extraHeaders: { cookie } });
    sockets.push(socket);
    await new Promise<void>(resolve => socket.on('connect', () => resolve()));
    if (subscribe) await socket.emitWithAck('subscribe', subscribe);
    // dá tempo da autenticação do handshake entrar na sala do usuário
    await new Promise(resolve => setTimeout(resolve, 150));
    return socket;
  }
  const once = (socket: Socket, event: string) => new Promise<unknown>(resolve => socket.once(event, resolve));

  describe('permissões novas (catálogo)', () => {
    it('os padrões do atendente e do gestor são coerentes e todas as chaves existem no catálogo', () => {
      const keys = PERMISSIONS.map(p => p.key);
      for (const role of ['attendant', 'manager'] as const) for (const permission of ROLE_DEFAULT_PERMISSIONS[role]) expect(keys).toContain(permission);
      expect(ROLE_DEFAULT_PERMISSIONS.manager).toEqual(expect.arrayContaining(['orders.estimate', 'kitchen.manage', 'shift.manage', 'tabs.manage', 'stock.manage', 'dashboard.view']));
      expect(ROLE_DEFAULT_PERMISSIONS.attendant).toContain('tabs.manage');
      expect(ROLE_DEFAULT_PERMISSIONS.attendant).not.toContain('orders.refund');
      expect(ROLE_DEFAULT_PERMISSIONS.attendant).not.toContain('dashboard.view');
    });
  });

  describe('chamado de garçom (18)', () => {
    it('cliente chama, a equipe vê em tempo real, resolve, e o cliente é avisado da resolução', async () => {
      const staff = await connect(world.managerA.email, { establishmentId: world.estA.id });
      const customer = await connect(world.client.email);
      const staffEvent = once(staff, REALTIME_EVENTS.tableCallUpdated);
      const created = await client.post('/api/table-calls').set(CSRF).send({ tableId });
      expect(created.status).toBe(201);
      await expect(staffEvent).resolves.toMatchObject({ establishmentId: world.estA.id, tableId, callId: created.body.id });

      const mine = await client.get(`/api/table-calls/mine?tableId=${tableId}`);
      expect(mine.body.call).toMatchObject({ id: created.body.id, resolvedAt: null });
      const open = await attendant.get(`${base()}/table-calls`);
      expect(open.body).toEqual([expect.objectContaining({ id: created.body.id, tableLabel: 'Mesa 1', resolvedAt: null })]);
      // repetir enquanto aberto devolve o mesmo chamado
      expect((await client.post('/api/table-calls').set(CSRF).send({ tableId })).body.id).toBe(created.body.id);

      const customerEvent = once(customer, REALTIME_EVENTS.tableCallUpdated);
      expect((await attendant.post(`${base()}/table-calls/${created.body.id}/resolve`).set(CSRF)).status).toBe(204);
      await expect(customerEvent).resolves.toMatchObject({ callId: created.body.id });
      expect((await client.get(`/api/table-calls/${created.body.id}`)).body.resolvedAt).not.toBeNull();
      expect((await client.get(`/api/table-calls/mine?tableId=${tableId}`)).body).toEqual({ call: null });
      expect((await attendant.get(`${base()}/table-calls`)).body).toEqual([]);
      // resolver de novo é inofensivo; depois de resolvido pode chamar de novo
      expect((await attendant.post(`${base()}/table-calls/${created.body.id}/resolve`).set(CSRF)).status).toBe(204);
      expect((await client.post('/api/table-calls').set(CSRF).send({ tableId })).body.id).not.toBe(created.body.id);
    });

    it('chamado de outro cliente e de outra casa respondem 404; cliente não resolve', async () => {
      const call = (await client.post('/api/table-calls').set(CSRF).send({ tableId })).body;
      const stranger = await login(t.browser(), 'outro@test.dev');
      expect((await stranger.get(`/api/table-calls/${call.id}`)).status).toBe(404);
      const managerB = await login(t.browser(), world.managerB.email);
      expect((await managerB.post(`/api/establishments/${world.estB.id}/table-calls/${call.id}/resolve`).set(CSRF)).status).toBe(404);
      expect((await client.post(`${base()}/table-calls/${call.id}/resolve`).set(CSRF)).status).toBe(403);
      expect((await client.post('/api/table-calls').set(CSRF).send({ tableId: '6f1c0f7e-4f0e-4c52-9d3a-0d6b1c1f9a11' })).status).toBe(404);
    });

    it('o evento de pedido pronto chega só ao dono', async () => {
      const owner = await connect(world.client.email);
      const other = await connect('outro@test.dev');
      const order = await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'preparing', items: [{ menuItemId: world.itemA.id, name: 'IPA', unitPriceCents: 2000 }] });
      let leaked = false;
      other.on(REALTIME_EVENTS.orderReady, () => (leaked = true));
      const ready = once(owner, REALTIME_EVENTS.orderReady);
      expect((await attendant.patch(`${base()}/orders/${order.id}/status`).set(CSRF).send({ status: 'ready' })).status).toBe(200);
      await expect(ready).resolves.toEqual({ establishmentId: world.estA.id, orderId: order.id });
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(leaked).toBe(false);
    });
  });

  describe('posição na fila (51)', () => {
    const item = { menuItemId: '', name: 'IPA', unitPriceCents: 2000 };
    const place = (status: 'received' | 'paid' | 'preparing' | 'ready' | 'delivered', minutesAgo: number, userId = world.client.id, data?: Record<string, unknown>) =>
      seedOrder(t.prisma, { userId, establishmentId: world.estA.id, status, paidAt: new Date(Date.now() - minutesAgo * 60_000), items: [{ ...item, menuItemId: world.itemA.id }], data });

    it('posição FIFO entre pagos e em preparo, com tempo restante, e atualiza quando a fila anda', async () => {
      const outro = world.attendantA.id; // outro usuário qualquer
      const first = await place('preparing', 10, outro);
      const second = await place('paid', 5, outro);
      const mine = await place('paid', 2);
      await place('delivered', 30, outro); // fora da fila
      await place('received', 1, outro); // não pago e sem comanda: fora da fila
      let res = await client.get(`/api/orders/${mine.id}/queue-position`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ state: 'waiting', position: 3, ordersAhead: 2, estimatedMinutes: 15, late: false });
      expect(res.body.remainingMinutes).toBe(13);

      await attendant.patch(`${base()}/orders/${first.id}/status`).set(CSRF).send({ status: 'ready' });
      res = await client.get(`/api/orders/${mine.id}/queue-position`);
      expect(res.body).toMatchObject({ position: 2, ordersAhead: 1 });
      await attendant.patch(`${base()}/orders/${second.id}/status`).set(CSRF).send({ status: 'preparing' });
      await attendant.patch(`${base()}/orders/${mine.id}/status`).set(CSRF).send({ status: 'preparing' });
      expect((await client.get(`/api/orders/${mine.id}/queue-position`)).body).toMatchObject({ state: 'preparing', position: 2 });
    });

    it('reflete o ajuste de tempo, atraso, pronto/encerrado e esconde pedido alheio', async () => {
      const slow = await place('paid', 20);
      expect((await client.get(`/api/orders/${slow.id}/queue-position`)).body).toMatchObject({ late: true, remainingMinutes: 0 });
      await manager.patch(`${base()}/orders/${slow.id}/estimate`).set(CSRF).send({ minutes: 60 });
      expect((await client.get(`/api/orders/${slow.id}/queue-position`)).body).toMatchObject({ late: false, estimatedMinutes: 60, remainingMinutes: 40 });
      const unpaid = await place('received', 1);
      expect((await client.get(`/api/orders/${unpaid.id}/queue-position`)).body).toMatchObject({ state: 'waiting', position: null });
      const ready = await place('ready', 5);
      expect((await client.get(`/api/orders/${ready.id}/queue-position`)).body).toMatchObject({ state: 'ready', position: null });
      const done = await place('delivered', 5);
      expect((await client.get(`/api/orders/${done.id}/queue-position`)).body.state).toBe('done');
      const stranger = await login(t.browser(), 'outro@test.dev');
      expect((await stranger.get(`/api/orders/${slow.id}/queue-position`)).status).toBe(404);
    });

    it('emite queue.updated na sala pública do restaurante quando a fila muda', async () => {
      const watcher = await connect(world.client.email, { restaurantId: world.estA.id });
      const order = await place('paid', 1);
      const event = once(watcher, REALTIME_EVENTS.queueUpdated);
      await attendant.patch(`${base()}/orders/${order.id}/status`).set(CSRF).send({ status: 'preparing' });
      await expect(event).resolves.toEqual({ establishmentId: world.estA.id });
    });
  });

  describe('onboarding (07)', () => {
    it('é lembrado por conta, em qualquer aparelho, e concluir de novo não muda a data', async () => {
      expect((await client.get('/api/me/onboarding')).body).toEqual({ completed: false, completedAt: null });
      expect((await client.get('/api/me')).body.user.onboardingCompletedAt).toBeNull();
      const done = await client.post('/api/me/onboarding/complete').set(CSRF).send({ skipped: true });
      expect(done.status).toBe(200);
      expect(done.body.completed).toBe(true);
      const again = await client.post('/api/me/onboarding/complete').set(CSRF).send({});
      expect(again.body.completedAt).toBe(done.body.completedAt);
      const otherDevice = await login(t.browser(), world.client.email);
      expect((await otherDevice.get('/api/me/onboarding')).body.completed).toBe(true);
      expect((await otherDevice.get('/api/me')).body.user.onboardingCompletedAt).toBe(done.body.completedAt);
      // outra conta não é afetada
      const stranger = await login(t.browser(), 'outro@test.dev').catch(() => null);
      if (stranger) expect((await stranger.get('/api/me/onboarding')).body.completed).toBe(false);
    });

    it('exige login', async () => {
      expect((await t.browser().get('/api/me/onboarding')).status).toBe(401);
      expect((await t.browser().post('/api/me/onboarding/complete').set(CSRF).send({})).status).toBe(401);
    });
  });

  describe('dashboard (27)', () => {
    it('mostra só dados reais do dia: pedidos, faturamento, ticket médio, mesas, fila e atrasados', async () => {
      const item = (price: number) => [{ menuItemId: world.itemA.id, name: 'IPA', unitPriceCents: price }];
      const mk = (status: 'paid' | 'delivered' | 'cancelled' | 'preparing', price: number, paidAt: Date, data?: Record<string, unknown>) =>
        seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status, paidAt, items: item(price), data });
      await mk('delivered', 3000, new Date());
      await mk('paid', 1001, new Date(Date.now() - 40 * 60_000)); // atrasado (15 min)
      await mk('preparing', 2000, new Date());
      await mk('cancelled', 9999, new Date(), { cancelledAt: new Date() }); // não conta
      await mk('delivered', 7777, new Date(Date.now() - 3 * 24 * 3600_000)); // outro dia
      await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'received', items: item(5000) }); // não pago
      await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estB.id, status: 'paid', items: [{ menuItemId: world.itemB.id, name: 'P', unitPriceCents: 4000 }] }); // outra casa
      await t.prisma.diningTable.update({ where: { id: tableId }, data: { occupancy: 'occupied', occupiedSince: new Date() } });
      await t.prisma.waitlistEntry.create({ data: { establishmentId: world.estA.id, name: 'G', phone: '19988887777', partySize: 2, position: 1, quotedWaitMinutes: 10 } });

      const res = await manager.get(`${base()}/dashboard`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ordersCount: 3, revenueCents: 6001, averageTicketCents: 2000, occupiedTables: 1, totalTables: 1, waitlistCount: 1, lateOrders: 1 });
      expect(new Date(res.body.dayEnd).getTime() - new Date(res.body.dayStart).getTime()).toBeGreaterThanOrEqual(23 * 3600_000);
    });

    it('casa sem movimento mostra zeros; só quem tem dashboard.view vê', async () => {
      const empty = await manager.get(`${base()}/dashboard`);
      expect(empty.body).toMatchObject({ ordersCount: 0, revenueCents: 0, averageTicketCents: 0, lateOrders: 0, waitlistCount: 0 });
      expect((await attendant.get(`${base()}/dashboard`)).status).toBe(403);
      expect((await client.get(`${base()}/dashboard`)).status).toBe(403);
      const managerB = await login(t.browser(), world.managerB.email);
      expect((await managerB.get(`${base()}/dashboard`)).status).toBe(403);
    });
  });
});
