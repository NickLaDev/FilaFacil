import { io, type Socket } from 'socket.io-client';
import { REALTIME_EVENTS } from '@filafacil/shared';
import { resetDatabase } from '../helpers/database.js';
import { createWorld, login, PASSWORD, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, placeOrder, verifyEmail } from '../helpers/orders.js';
import { FakePaymentGateway } from '../helpers/fake-gateway.js';
import { createTestApp, CSRF, type TestApp } from '../helpers/test-app.js';

const DAY = 24 * 60 * 60 * 1000;

describe('Pedidos, QR Code e andamento (fichas 02, 08 e 09)', () => {
  let t: TestApp;
  let gateway: FakePaymentGateway;
  let world: World;
  let extra: Awaited<ReturnType<typeof createOrdersWorld>>;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    gateway = new FakePaymentGateway();
    t = await createTestApp(undefined, gateway);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    extra = await createOrdersWorld(t.prisma, world);
  });
  afterEach(() => sockets.splice(0).forEach(socket => socket.close()));

  const clientAgent = () => login(t.browser(), world.client.email);
  const order = (agent: Awaited<ReturnType<typeof clientAgent>>, items = [{ menuItemId: world.itemA.id, quantity: 2 }], extraBody = {}) =>
    placeOrder(agent, { establishmentId: world.estA.id, tableId: extra.tableA.id, items, ...extraBody }, CSRF);

  /** Leva um pedido até "pago" pelo mesmo caminho do produto: Pix + gateway aprovando + sincronização. */
  async function paidOrder(agent: Awaited<ReturnType<typeof clientAgent>>) {
    await verifyEmail(t.prisma, world.client.id);
    const created = await order(agent);
    await agent.post(`/api/orders/${created.body.id}/payments`).set(CSRF).send({ method: 'pix' });
    gateway.set(gateway.lastId, { status: 'approved' });
    const synced = await agent.post(`/api/orders/${created.body.id}/payments/sync`).set(CSRF);
    expect(synced.body.status).toBe('paid');
    return created.body.id as string;
  }

  describe('QR Code (ficha 02)', () => {
    it('resolve o código para estabelecimento e mesa, ignorando maiúsculas e minúsculas', async () => {
      const response = await t.browser().get('/api/restaurants/qr/bara-1111');
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        establishmentId: world.estA.id,
        establishmentName: 'Bar A',
        tableId: extra.tableA.id,
        tableLabel: 'Mesa 1',
        acceptingOrders: true,
      });
    });

    it('resolve mesas criadas depois pela planta do gestor (QR gerado pelo servidor)', async () => {
      const manager = await login(t.browser(), world.managerA.email);
      const plan = await manager.get(`/api/establishments/${world.estA.id}/floor-plan`);
      const saved = await manager
        .put(`/api/establishments/${world.estA.id}/floor-plan`)
        .set(CSRF)
        .send({
          version: plan.body.version,
          tables: [
            ...plan.body.tables.map(({ id, label, shape, capacity, x, y }: Record<string, unknown>) => ({ id, label, shape, capacity, x, y })),
            { label: 'Mesa nova', shape: 'round', capacity: 2, x: 50, y: 50 },
          ],
        });
      expect(saved.status).toBe(200);
      const created = saved.body.tables.find((table: { label: string }) => table.label === 'Mesa nova');
      const resolved = await t.browser().get(`/api/restaurants/qr/${created.qrCode}`);
      expect(resolved.body).toMatchObject({ tableId: created.id, tableLabel: 'Mesa nova', establishmentId: world.estA.id });
    });

    it('código inexistente, malformado ou de casa inativa responde 404', async () => {
      expect((await t.browser().get('/api/restaurants/qr/NAO-EXISTE')).status).toBe(404);
      expect((await t.browser().get('/api/restaurants/qr/..%2F..')).status).toBe(404);
      await t.prisma.establishment.update({ where: { id: world.estA.id }, data: { status: 'inactive' } });
      expect((await t.browser().get('/api/restaurants/qr/BARA-1111')).status).toBe(404);
    });

    it('casa inativa/suspensa: não cria pedido novo e não deixa pagar pedido já criado (ficha 34)', async () => {
      const agent = await clientAgent();
      await verifyEmail(t.prisma, world.client.id);
      const unpaid = await order(agent);
      expect(unpaid.status).toBe(201);
      for (const status of ['suspended', 'inactive'] as const) {
        await t.prisma.establishment.update({ where: { id: world.estA.id }, data: { status } });
        expect((await order(agent)).status).toBe(404);
        const pay = await agent.post(`/api/orders/${unpaid.body.id}/payments`).set(CSRF).send({ method: 'pix' });
        expect(pay.status).toBe(422);
        expect(pay.body.code).toBe('ESTABLISHMENT_NOT_ACCEPTING_ORDERS');
      }
    });

    it('informa que a casa não aceita pedidos quando está pausada', async () => {
      await t.prisma.establishment.update({ where: { id: world.estA.id }, data: { ordersPaused: true } });
      const response = await t.browser().get('/api/restaurants/qr/BARA-1111');
      expect(response.body).toMatchObject({ acceptingOrders: false, orderingStatus: 'paused' });
    });
  });

  describe('criação do pedido (fichas 08 e 02)', () => {
    it('calcula o total no servidor, associa a mesa e guarda o snapshot dos itens', async () => {
      const agent = await clientAgent();
      const response = await order(agent);
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        status: 'received',
        totalCents: 4000,
        tableId: extra.tableA.id,
        tableLabel: 'Mesa 1',
        establishmentName: 'Bar A',
        pickupPoint: 'Balcão',
        pickupCode: null,
        payment: null,
      });
      expect(response.body.items).toEqual([{ menuItemId: world.itemA.id, name: 'IPA', quantity: 2, unitPriceCents: 2000, notes: '' }]);

      // Mudar o preço depois não altera o pedido.
      await t.prisma.menuItem.update({ where: { id: world.itemA.id }, data: { priceCents: 9999, name: 'IPA nova' } });
      const again = await agent.get(`/api/orders/${response.body.id}`);
      expect(again.body).toMatchObject({ totalCents: 4000 });
      expect(again.body.items[0]).toMatchObject({ name: 'IPA', unitPriceCents: 2000 });
    });

    it('aplica a promoção vigente do servidor e recusa total divergente do exibido', async () => {
      const promotion = await t.prisma.promotion.create({
        data: { establishmentId: world.estA.id, name: 'Promo', discountPercent: 25, startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + DAY), items: { create: [{ menuItemId: world.itemA.id }] } },
      });
      const agent = await clientAgent();
      const ok = await order(agent, [{ menuItemId: world.itemA.id, quantity: 1 }], { expectedTotalCents: 1500 });
      expect(ok.status).toBe(201);
      expect(ok.body.totalCents).toBe(1500);

      // Promoção termina antes da confirmação: o cliente via R$ 15,00 e o servidor cobraria R$ 20,00.
      await t.prisma.promotion.update({ where: { id: promotion.id }, data: { endsAt: new Date(Date.now() - 1000) } });
      const stale = await order(agent, [{ menuItemId: world.itemA.id, quantity: 1 }], { expectedTotalCents: 1500 });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('PRICE_CHANGED');
      expect(await t.prisma.order.count()).toBe(1);
    });

    it('recusa item indisponível, de outro estabelecimento, mesa de outro bar, quantidade inválida e casa fechada', async () => {
      const agent = await clientAgent();
      await t.prisma.menuItem.update({ where: { id: world.itemA.id }, data: { available: false } });
      const unavailable = await order(agent);
      expect(unavailable.status).toBe(422);
      expect(unavailable.body.code).toBe('ITEM_UNAVAILABLE');
      await t.prisma.menuItem.update({ where: { id: world.itemA.id }, data: { available: true } });

      const foreignItem = await order(agent, [{ menuItemId: world.itemB.id, quantity: 1 }]);
      expect(foreignItem.body.code).toBe('ITEM_UNAVAILABLE');

      const foreignTable = await placeOrder(agent, { establishmentId: world.estA.id, tableId: extra.tableB.id, items: [{ menuItemId: world.itemA.id, quantity: 1 }] }, CSRF);
      expect(foreignTable.body.code).toBe('INVALID_TABLE');

      expect((await order(agent, [{ menuItemId: world.itemA.id, quantity: 0 }])).status).toBe(400);
      expect((await order(agent, [{ menuItemId: world.itemA.id, quantity: 21 }])).status).toBe(400);
      expect((await order(agent, [])).status).toBe(400);

      await t.prisma.establishment.update({ where: { id: world.estA.id }, data: { ordersPaused: true } });
      const paused = await order(agent);
      expect(paused.status).toBe(422);
      expect(paused.body.code).toBe('ESTABLISHMENT_NOT_ACCEPTING_ORDERS');
      expect(await t.prisma.order.count()).toBe(0);
    });

    it('reenviar o mesmo identificador de checkout devolve o mesmo pedido (sem duplicar)', async () => {
      const agent = await clientAgent();
      const body = { establishmentId: world.estA.id, tableId: extra.tableA.id, items: [{ menuItemId: world.itemA.id, quantity: 1 }], clientRequestId: 'checkout-0001-abc' };
      const [first, second, third] = await Promise.all([
        agent.post('/api/orders').set(CSRF).send(body),
        agent.post('/api/orders').set(CSRF).send(body),
        agent.post('/api/orders').set(CSRF).send(body),
      ]);
      expect([first.status, second.status, third.status].every(status => status === 201 || status === 200)).toBe(true);
      expect(new Set([first.body.id, second.body.id, third.body.id]).size).toBe(1);
      expect(await t.prisma.order.count()).toBe(1);
    });

    it('exige login e a permissão de fazer pedidos', async () => {
      expect((await placeOrder(t.browser(), { establishmentId: world.estA.id, items: [{ menuItemId: world.itemA.id, quantity: 1 }] }, CSRF)).status).toBe(401);
      const manager = await login(t.browser(), world.managerA.email);
      const response = await placeOrder(manager, { establishmentId: world.estA.id, items: [{ menuItemId: world.itemA.id, quantity: 1 }] }, CSRF);
      expect(response.status).toBe(403);
    });

    it('cliente só enxerga os próprios pedidos', async () => {
      const agent = await clientAgent();
      const created = await order(agent);
      const mine = await agent.get('/api/orders');
      expect(mine.body.items.map((item: { id: string }) => item.id)).toEqual([created.body.id]);

      const other = await login(t.browser(), extra.otherClient.email);
      expect((await other.get(`/api/orders/${created.body.id}`)).status).toBe(404);
      expect((await other.get('/api/orders')).body.total).toBe(0);
      expect((await other.post(`/api/orders/${created.body.id}/payments`).set(CSRF).send({ method: 'pix' })).status).toBe(404);
    });
  });

  describe('andamento do pedido pela equipe (ficha 09)', () => {
    const staffBase = () => `/api/establishments/${world.estA.id}/orders`;

    it('só pedidos pagos entram na fila e o status avança um passo por vez', async () => {
      const agent = await clientAgent();
      await verifyEmail(t.prisma, world.client.id);
      const unpaid = await order(agent);
      const attendant = await login(t.browser(), world.attendantA.email);
      expect((await attendant.get(staffBase())).body.total).toBe(0);

      const orderId = await paidOrder(agent);
      const list = await attendant.get(staffBase());
      expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([orderId]);
      expect(list.body.items[0]).toMatchObject({ customerName: 'Cliente', status: 'paid' });

      // Não pago não entra na cozinha; não pula etapa; não volta.
      expect((await attendant.patch(`${staffBase()}/${unpaid.body.id}/status`).set(CSRF).send({ status: 'preparing' })).body.code).toBe('INVALID_STATUS_TRANSITION');
      expect((await attendant.patch(`${staffBase()}/${orderId}/status`).set(CSRF).send({ status: 'ready' })).status).toBe(422);
      expect((await attendant.patch(`${staffBase()}/${orderId}/status`).set(CSRF).send({ status: 'received' })).status).toBe(422);

      for (const status of ['preparing', 'ready', 'delivered']) {
        const step = await attendant.patch(`${staffBase()}/${orderId}/status`).set(CSRF).send({ status });
        expect(step.status).toBe(200);
        expect(step.body.status).toBe(status);
      }
      expect((await attendant.patch(`${staffBase()}/${orderId}/status`).set(CSRF).send({ status: 'delivered' })).status).toBe(422);
      expect((await attendant.get(staffBase())).body.total).toBe(0);

      // O cliente vê o resultado, com o código de retirada depois de pronto.
      const mine = await agent.get(`/api/orders/${orderId}`);
      expect(mine.body).toMatchObject({ status: 'delivered', estimatedMinutes: null });
      expect(mine.body.pickupCode).toMatch(/^\d{4}$/);
    });

    it('mostra estimativa e local de retirada reais da casa', async () => {
      await t.prisma.establishment.update({ where: { id: world.estA.id }, data: { averageWaitMinutes: 22, pickupPoint: 'Balcão 2' } });
      const agent = await clientAgent();
      const orderId = await paidOrder(agent);
      expect((await agent.get(`/api/orders/${orderId}`)).body).toMatchObject({ estimatedMinutes: 22, pickupPoint: 'Balcão 2', pickupCode: null });
    });

    it('isola os estabelecimentos e as permissões da equipe', async () => {
      const agent = await clientAgent();
      const orderId = await paidOrder(agent);

      const otherManager = await login(t.browser(), world.managerB.email);
      expect((await otherManager.get(staffBase())).status).toBe(403);
      expect((await otherManager.patch(`${staffBase()}/${orderId}/status`).set(CSRF).send({ status: 'preparing' })).status).toBe(403);
      // Mesmo na própria casa, pedido de outra casa responde 404.
      const crossed = await otherManager.patch(`/api/establishments/${world.estB.id}/orders/${orderId}/status`).set(CSRF).send({ status: 'preparing' });
      expect(crossed.status).toBe(404);

      expect((await agent.get(staffBase())).status).toBe(403);
      expect((await t.browser().get(staffBase())).status).toBe(401);
      const attendant = await login(t.browser(), world.attendantA.email);
      expect((await attendant.post(`${staffBase()}/${orderId}/refund`).set(CSRF)).status).toBe(403);
    });

    it('duas pessoas avançando ao mesmo tempo não pulam etapas', async () => {
      const agent = await clientAgent();
      const orderId = await paidOrder(agent);
      const attendant = await login(t.browser(), world.attendantA.email);
      const manager = await login(t.browser(), world.managerA.email);
      const results = await Promise.all([
        attendant.patch(`${staffBase()}/${orderId}/status`).set(CSRF).send({ status: 'preparing' }),
        manager.patch(`${staffBase()}/${orderId}/status`).set(CSRF).send({ status: 'preparing' }),
      ]);
      expect(results.filter(result => result.status === 200)).toHaveLength(1);
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('preparing');
    });
  });

  describe('tempo real (ficha 09)', () => {
    async function connect(email: string | null) {
      let cookie = '';
      if (email) {
        const response = await t.browser().post('/api/auth/login').set(CSRF).send({ email, password: PASSWORD });
        cookie = ([] as string[]).concat(response.headers['set-cookie'] ?? []).map(c => c.split(';')[0]).join('; ');
      }
      const socket = io(`http://localhost:${t.port}/realtime`, { path: '/api/socket.io', transports: ['websocket'], extraHeaders: { cookie } });
      sockets.push(socket);
      await new Promise<void>(resolve => socket.on('connect', () => resolve()));
      return { socket, cookie };
    }

    it('informa se a conexão tem sessão: conexão anônima fica conectada, mas sinaliza que não receberá eventos da conta', async () => {
      /** O aviso pode chegar antes do "connect" ser observado: o ouvinte nasce junto com o socket. */
      async function readyOf(cookie: string) {
        const socket = io(`http://localhost:${t.port}/realtime`, { path: '/api/socket.io', transports: ['websocket'], extraHeaders: { cookie } });
        sockets.push(socket);
        return new Promise<unknown>(resolve => socket.once(REALTIME_EVENTS.ready, resolve));
      }
      const login_ = await t.browser().post('/api/auth/login').set(CSRF).send({ email: world.client.email, password: PASSWORD });
      const cookie = ([] as string[]).concat(login_.headers['set-cookie'] ?? []).map(c => c.split(';')[0]).join('; ');
      expect(await readyOf('')).toEqual({ authenticated: false });
      expect(await readyOf(cookie)).toEqual({ authenticated: true });
      expect(await readyOf('ff_access=token-invalido')).toEqual({ authenticated: false });
    });

    it('avisa só o dono do pedido e a equipe da casa a cada mudança', async () => {
      const owner = await connect(world.client.email);
      const stranger = await connect(extra.otherClient.email);
      const staff = await connect(world.attendantA.email);
      const otherHouse = await connect(world.managerB.email);
      expect(await staff.socket.emitWithAck('subscribe', { establishmentId: world.estA.id })).toEqual({ ok: true });
      expect(await otherHouse.socket.emitWithAck('subscribe', { establishmentId: world.estB.id })).toEqual({ ok: true });

      const received: Record<string, unknown[]> = { owner: [], stranger: [], staff: [], otherHouse: [] };
      owner.socket.on(REALTIME_EVENTS.orderUpdated, payload => received.owner?.push(payload));
      stranger.socket.on(REALTIME_EVENTS.orderUpdated, payload => received.stranger?.push(payload));
      staff.socket.on(REALTIME_EVENTS.orderUpdated, payload => received.staff?.push(payload));
      otherHouse.socket.on(REALTIME_EVENTS.orderUpdated, payload => received.otherHouse?.push(payload));

      const agent = await clientAgent();
      const orderId = await paidOrder(agent); // criação + pagamento aprovado
      const attendant = await login(t.browser(), world.attendantA.email);
      await attendant.patch(`/api/establishments/${world.estA.id}/orders/${orderId}/status`).set(CSRF).send({ status: 'preparing' });

      await vi.waitFor(() => expect(received.owner?.length).toBeGreaterThanOrEqual(3));
      expect(received.owner?.every(payload => (payload as { orderId: string }).orderId === orderId)).toBe(true);
      expect(received.owner?.at(-1)).toEqual({ establishmentId: world.estA.id, orderId });
      expect(received.staff?.length).toBeGreaterThanOrEqual(3);
      expect(received.stranger).toEqual([]);
      expect(received.otherHouse).toEqual([]);
    });
  });
});
