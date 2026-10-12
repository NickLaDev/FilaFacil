import { io, type Socket } from 'socket.io-client';
import { REALTIME_EVENTS, type TableMapDto } from '@filafacil/shared';
import { resetDatabase } from '../helpers/database.js';
import { createWorld, login, PASSWORD, type World } from '../helpers/fixtures.js';
import { placeOrder, verifyEmail } from '../helpers/orders.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

describe('Mapa de mesas e mescla (fichas 16 e 47)', () => {
  let t: TestApp;
  let world: World;
  let attendant: Agent;
  let manager: Agent;
  let client: Agent;
  let tables: { t1: string; t2: string; t3: string };
  const sockets: Socket[] = [];
  const previous = { provider: process.env.PAYMENT_PROVIDER, allow: process.env.ALLOW_SIMULATED_PAYMENTS };

  beforeAll(async () => {
    process.env.PAYMENT_PROVIDER = 'simulated';
    process.env.ALLOW_SIMULATED_PAYMENTS = 'true';
    t = await createTestApp();
  });
  afterAll(async () => {
    process.env.PAYMENT_PROVIDER = previous.provider;
    process.env.ALLOW_SIMULATED_PAYMENTS = previous.allow;
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    await verifyEmail(t.prisma, world.client.id);
    const plan = await t.prisma.floorPlan.create({ data: { establishmentId: world.estA.id } });
    const make = (label: string, capacity: number, x: number) =>
      t.prisma.diningTable.create({
        data: { floorPlanId: plan.id, establishmentId: world.estA.id, label, shape: 'square', capacity, positionX: x, positionY: 10, qrCode: `BARA-${label.slice(-1)}00${label.slice(-1)}` },
      });
    tables = { t1: (await make('Mesa 1', 4, 10)).id, t2: (await make('Mesa 2', 2, 30)).id, t3: (await make('Mesa 3', 6, 50)).id };
    attendant = await login(t.browser(), world.attendantA.email);
    manager = await login(t.browser(), world.managerA.email);
    client = await login(t.browser(), world.client.email);
  });
  afterEach(() => sockets.splice(0).forEach(socket => socket.close()));

  const url = (path: string) => `/api/establishments/${world.estA.id}/${path}`;
  const getMap = async (agent: Agent = attendant) => (await agent.get(url('table-map'))).body as TableMapDto;
  const row = (map: TableMapDto, id: string) => map.tables.find(table => table.id === id)!;
  const post = (agent: Agent, path: string, body: object = {}) => agent.post(url(path)).set(CSRF).send(body);

  describe('estados e ações (ficha 16)', () => {
    it('lista as mesas livres e restringe o acesso por papel e estabelecimento', async () => {
      const map = await getMap();
      expect(map.tables.map(table => table.status)).toEqual(['free', 'free', 'free']);
      expect(map.groups).toEqual([]);
      expect((await client.get(url('table-map'))).status).toBe(403);
      expect((await t.browser().get(url('table-map'))).status).toBe(401);
      const managerB = await login(t.browser(), world.managerB.email);
      expect((await managerB.get(url('table-map'))).status).toBe(403);
    });

    it('ocupa com número de pessoas, reserva, cancela, libera e prioriza chamado > ocupada > reservada', async () => {
      let map = (await post(attendant, `tables/${tables.t1}/occupy`, { partySize: 3 })).body as TableMapDto;
      expect(row(map, tables.t1)).toMatchObject({ status: 'occupied', partySize: 3 });
      expect(row(map, tables.t1).since).not.toBeNull();
      expect((await post(attendant, `tables/${tables.t1}/occupy`, { partySize: 0 })).status).toBe(400);

      const reserved = await post(attendant, `tables/${tables.t2}/reservations`, { name: 'Família Silva', partySize: 4 });
      map = reserved.body;
      expect(row(map, tables.t2)).toMatchObject({ status: 'reserved', reservation: { name: 'Família Silva', partySize: 4 } });
      expect((await post(attendant, `tables/${tables.t2}/reservations`, { name: 'Outro', partySize: 2 })).status).toBe(409);
      expect((await post(attendant, `tables/${tables.t1}/reservations`, { name: 'Outro', partySize: 2 })).status).toBe(409);

      const reservationId = row(map, tables.t2).reservation!.id;
      map = (await attendant.delete(url(`tables/${tables.t2}/reservations/${reservationId}`)).set(CSRF)).body;
      expect(row(map, tables.t2).status).toBe('free');
      expect((await attendant.delete(url(`tables/${tables.t2}/reservations/${reservationId}`)).set(CSRF)).status).toBe(404);

      // Sentar clientes numa mesa reservada encerra a reserva.
      await post(attendant, `tables/${tables.t2}/reservations`, { name: 'Casal', partySize: 2 });
      map = (await post(attendant, `tables/${tables.t2}/occupy`, { partySize: 2 })).body;
      expect(row(map, tables.t2)).toMatchObject({ status: 'occupied', reservation: null });

      await client.post('/api/table-calls').set(CSRF).send({ tableId: tables.t1 });
      expect(row(await getMap(), tables.t1).status).toBe('called');

      map = (await post(attendant, `tables/${tables.t1}/release`)).body;
      expect(row(map, tables.t1)).toMatchObject({ partySize: 0, since: null });
      // O chamado continua aberto até ser atendido.
      expect(row(map, tables.t1).status).toBe('called');
      map = (await post(attendant, `tables/${tables.t1}/calls/resolve`)).body;
      expect(row(map, tables.t1)).toMatchObject({ status: 'free', pendingCall: null });
    });

    it('reserva não vale para mesa de outro estabelecimento', async () => {
      const plan = await t.prisma.floorPlan.create({ data: { establishmentId: world.estB.id } });
      const foreign = await t.prisma.diningTable.create({
        data: { floorPlanId: plan.id, establishmentId: world.estB.id, label: 'Mesa 9', shape: 'round', capacity: 2, positionX: 1, positionY: 1, qrCode: 'BARB-9999' },
      });
      expect((await post(attendant, `tables/${foreign.id}/occupy`, { partySize: 2 })).status).toBe(404);
      expect((await post(attendant, `tables/${foreign.id}/release`)).status).toBe(404);
      expect((await post(attendant, `tables/${foreign.id}/reservations`, { name: 'X Y', partySize: 2 })).status).toBe(404);
      expect((await post(attendant, `tables/${foreign.id}/calls/resolve`)).status).toBe(404);
      expect((await attendant.get(url(`table-checks/${foreign.id}`))).status).toBe(404);
    });

    it('chamado do cliente: idempotente enquanto aberto, exige login e mesa existente', async () => {
      expect((await t.browser().post('/api/table-calls').set(CSRF).send({ tableId: tables.t1 })).status).toBe(401);
      expect((await client.post('/api/table-calls').set(CSRF).send({ tableId: '2f6a7c3e-0000-4000-8000-000000000000' })).status).toBe(404);
      expect((await client.post('/api/table-calls').set(CSRF).send({ tableId: 'x' })).status).toBe(400);
      const first = await client.post('/api/table-calls').set(CSRF).send({ tableId: tables.t1 });
      const second = await client.post('/api/table-calls').set(CSRF).send({ tableId: tables.t1 });
      expect(first.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
      expect(await t.prisma.tableCall.count({ where: { tableId: tables.t1 } })).toBe(1);
      const map = await getMap();
      expect(row(map, tables.t1).pendingCall).toMatchObject({ id: first.body.id });
      // Atendido, um novo chamado pode ser aberto.
      await post(attendant, `tables/${tables.t1}/calls/resolve`);
      const third = await client.post('/api/table-calls').set(CSRF).send({ tableId: tables.t1 });
      expect(third.body.id).not.toBe(first.body.id);
    });

    it('chamados simultâneos geram um único chamado aberto', async () => {
      const responses = await Promise.all(Array.from({ length: 6 }, () => client.post('/api/table-calls').set(CSRF).send({ tableId: tables.t3 })));
      expect(new Set(responses.map(response => response.body.id)).size).toBe(1);
      expect(await t.prisma.tableCall.count({ where: { tableId: tables.t3, resolvedAt: null } })).toBe(1);
    });

    it('pagamento aprovado ocupa a mesa do pedido e a conta consolida pedidos pagos', async () => {
      const order = await placeOrder(client, { establishmentId: world.estA.id, tableId: tables.t1, items: [{ menuItemId: world.itemA.id, quantity: 2 }] }, CSRF);
      expect(order.status).toBe(201);
      expect(row(await getMap(), tables.t1).status).toBe('free'); // pedido sem pagamento não ocupa
      const pay = await client.post(`/api/orders/${order.body.id}/payments`).set(CSRF).send({ method: 'credit', cardToken: 'sim_approved', paymentMethodId: 'simulated' });
      expect(pay.status).toBe(201);
      const map = await getMap();
      expect(row(map, tables.t1)).toMatchObject({ status: 'occupied' });
      expect(row(map, tables.t1).since).not.toBeNull();

      const check = (await attendant.get(url(`table-checks/${tables.t1}`))).body;
      expect(check.orders).toHaveLength(1);
      expect(check).toMatchObject({ totalCents: 4000, paidCents: 4000, label: 'Mesa 1' });
      expect(check.orders[0].items[0]).toMatchObject({ name: 'IPA', quantity: 2 });
    });

    it('qualquer mudança (chamado, ocupação, pagamento) chega à equipe pelo tempo real', async () => {
      const response = await t.browser().post('/api/auth/login').set(CSRF).send({ email: world.attendantA.email, password: PASSWORD });
      const cookie = ([] as string[]).concat(response.headers['set-cookie'] ?? []).map(c => c.split(';')[0]).join('; ');
      const socket = io(`http://localhost:${t.port}/realtime`, { path: '/api/socket.io', transports: ['websocket'], extraHeaders: { cookie } });
      sockets.push(socket);
      await new Promise<void>(resolve => socket.on('connect', () => resolve()));
      expect(await socket.emitWithAck('subscribe', { establishmentId: world.estA.id })).toEqual({ ok: true });

      let received = 0;
      socket.on(REALTIME_EVENTS.tablesUpdated, () => received++);
      await client.post('/api/table-calls').set(CSRF).send({ tableId: tables.t1 });
      await post(attendant, `tables/${tables.t2}/occupy`, { partySize: 2 });
      const order = await placeOrder(client, { establishmentId: world.estA.id, tableId: tables.t3, items: [{ menuItemId: world.itemA.id, quantity: 1 }] }, CSRF);
      await client.post(`/api/orders/${order.body.id}/payments`).set(CSRF).send({ method: 'credit', cardToken: 'sim_approved', paymentMethodId: 'simulated' });
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(received).toBeGreaterThanOrEqual(3);
    });

    it('liberar a mesa avisa o próximo grupo da fila de espera (ficha 21 preservada)', async () => {
      await post(attendant, `tables/${tables.t3}/occupy`, { partySize: 5 });
      const entry = await manager.post(url('waitlist')).set(CSRF).send({ name: 'Grupo', phone: '19988887777', partySize: 5 });
      expect(entry.status).toBe(201);
      await post(attendant, `tables/${tables.t3}/release`);
      const list = await manager.get(url('waitlist'));
      expect(list.body.entries[0]).toMatchObject({ status: 'notified', notifiedTableLabel: 'Mesa 3' });
    });
  });

  describe('mesclar mesas (ficha 47)', () => {
    it('só o gestor mescla; capacidade soma e o grupo aparece como uma unidade', async () => {
      expect((await post(attendant, 'table-groups', { tableIds: [tables.t1, tables.t2] })).status).toBe(403);
      expect((await post(manager, 'table-groups', { tableIds: [tables.t1] })).status).toBe(400);
      expect((await post(manager, 'table-groups', { tableIds: [tables.t1, tables.t1] })).status).toBe(400);

      const merged = await post(manager, 'table-groups', { tableIds: [tables.t1, tables.t2] });
      expect(merged.status).toBe(201);
      const map = merged.body as TableMapDto;
      expect(map.groups).toHaveLength(1);
      expect(map.groups[0]).toMatchObject({ label: 'Mesa 1 + Mesa 2', capacity: 6, status: 'free', x: 20, tableIds: [tables.t1, tables.t2] });
      expect(row(map, tables.t1).groupId).toBe(map.groups[0]!.id);
      expect(row(map, tables.t3).groupId).toBeNull();

      // Mesa já mesclada não entra em outro grupo.
      expect((await post(manager, 'table-groups', { tableIds: [tables.t2, tables.t3] })).status).toBe(409);
    });

    it('rejeita mesas de outro estabelecimento', async () => {
      const plan = await t.prisma.floorPlan.create({ data: { establishmentId: world.estB.id } });
      const foreign = await t.prisma.diningTable.create({
        data: { floorPlanId: plan.id, establishmentId: world.estB.id, label: 'Mesa 9', shape: 'round', capacity: 2, positionX: 1, positionY: 1, qrCode: 'BARB-9999' },
      });
      expect((await post(manager, 'table-groups', { tableIds: [tables.t1, foreign.id] })).status).toBe(404);
      const managerB = await login(t.browser(), world.managerB.email);
      expect((await managerB.post(url('table-groups')).set(CSRF).send({ tableIds: [tables.t1, tables.t2] })).status).toBe(403);
    });

    it('ações valem para o grupo todo, a conta é única e desfazer restaura as mesas', async () => {
      const merged = (await post(manager, 'table-groups', { tableIds: [tables.t1, tables.t2] })).body as TableMapDto;
      const groupId = merged.groups[0]!.id;

      const map = (await post(attendant, `tables/${tables.t2}/occupy`, { partySize: 5 })).body as TableMapDto;
      expect(map.groups[0]).toMatchObject({ status: 'occupied', partySize: 5 });
      expect(row(map, tables.t1).status).toBe('occupied');

      // Pedidos feitos pelo QR de cada mesa do grupo caem na mesma conta.
      for (const [tableId, qty] of [[tables.t1, 1], [tables.t2, 2]] as const) {
        const order = await placeOrder(client, { establishmentId: world.estA.id, tableId, items: [{ menuItemId: world.itemA.id, quantity: qty }] }, CSRF);
        await client.post(`/api/orders/${order.body.id}/payments`).set(CSRF).send({ method: 'credit', cardToken: 'sim_approved', paymentMethodId: 'simulated' });
      }
      const fromT1 = (await attendant.get(url(`table-checks/${tables.t1}`))).body;
      const fromT2 = (await attendant.get(url(`table-checks/${tables.t2}`))).body;
      expect(fromT1.orders).toHaveLength(2);
      expect(fromT1.totalCents).toBe(6000);
      expect(fromT1.paidCents).toBe(6000);
      expect(fromT2.orders.map((o: { id: string }) => o.id).sort()).toEqual(fromT1.orders.map((o: { id: string }) => o.id).sort());

      await client.post('/api/table-calls').set(CSRF).send({ tableId: tables.t1 });
      expect((await getMap()).groups[0]!.status).toBe('called');

      expect((await attendant.delete(url(`table-groups/${groupId}`)).set(CSRF)).status).toBe(403);
      const split = (await manager.delete(url(`table-groups/${groupId}`)).set(CSRF)).body as TableMapDto;
      expect(split.groups).toEqual([]);
      expect(row(split, tables.t1)).toMatchObject({ groupId: null, status: 'called', capacity: 4 });
      expect(row(split, tables.t2)).toMatchObject({ groupId: null, status: 'occupied', capacity: 2 });
      expect((await manager.delete(url(`table-groups/${groupId}`)).set(CSRF)).status).toBe(404);
    });

    it('liberar o grupo libera todas as mesas; excluir mesa da planta desfaz grupo com menos de duas mesas', async () => {
      const merged = (await post(manager, 'table-groups', { tableIds: [tables.t1, tables.t2] })).body as TableMapDto;
      await post(attendant, `tables/${tables.t1}/occupy`, { partySize: 3 });
      const released = (await post(attendant, `tables/${tables.t2}/release`)).body as TableMapDto;
      expect(released.groups[0]!.status).toBe('free');
      expect(released.tables.every(table => table.status === 'free')).toBe(true);

      const floor = await manager.get(url('floor-plan'));
      const keep = floor.body.tables
        .filter((table: { id: string }) => table.id !== tables.t1)
        .map((table: { id: string; label: string; shape: string; capacity: number; x: number; y: number }) => ({ id: table.id, label: table.label, shape: table.shape, capacity: table.capacity, x: table.x, y: table.y }));
      const saved = await manager.put(url('floor-plan')).set(CSRF).send({ version: floor.body.version, tables: keep });
      expect(saved.status).toBe(200);
      expect((await getMap()).groups).toEqual([]);
      expect(await t.prisma.tableGroup.count({ where: { id: merged.groups[0]!.id } })).toBe(0);
    });

    it('conta de mesa livre e sem grupo é vazia', async () => {
      const check = (await attendant.get(url(`table-checks/${tables.t3}`))).body;
      expect(check).toMatchObject({ orders: [], totalCents: 0, paidCents: 0 });
    });
  });
});
