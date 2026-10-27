import { PRINTER_OFFLINE_AFTER_MS } from '@filafacil/shared';
import { PrintersService } from '../../src/modules/kitchen/printers.service.js';
import { resetDatabase } from '../helpers/database.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { seedOrder } from '../helpers/orders.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

describe('Sprint 3 — fila, estações, impressoras, turno e ajuste de tempo (fichas 23, 24, 26, 25, 63)', () => {
  let t: TestApp;
  let world: World;
  let manager: Agent;
  let attendant: Agent;
  const base = () => `/api/establishments/${world.estA.id}`;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    manager = await login(t.browser(), world.managerA.email);
    attendant = await login(t.browser(), world.attendantA.email);
  });

  const item = (stationId: string | null = null, name = 'IPA') => ({ menuItemId: world.itemA.id, name, unitPriceCents: 2000, stationId });
  const order = (status: 'paid' | 'preparing' | 'ready' | 'delivered' | 'cancelled' | 'received' = 'paid', items = [item()], data?: Record<string, unknown>, paidAt?: Date) =>
    seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status, items, data, paidAt });

  describe('fila de pedidos (23)', () => {
    it('lista em FIFO por pagamento, com idade e atraso acima da estimativa, e filtra por status', async () => {
      const old = await order('paid', [item()], undefined, new Date(Date.now() - 40 * 60_000));
      const fresh = await order('preparing');
      await order('delivered');
      await order('received'); // não pago e sem comanda: fora da fila
      const res = await attendant.get(`${base()}/orders/queue`);
      expect(res.status).toBe(200);
      expect(res.body.items.map((o: { id: string }) => o.id)).toEqual([old.id, fresh.id]);
      expect(res.body.items[0]).toMatchObject({ queuePosition: 1, late: true });
      expect(res.body.items[0].ageMinutes).toBeGreaterThanOrEqual(40);
      expect(res.body.items[1]).toMatchObject({ queuePosition: 2, late: false });
      expect(res.body).toMatchObject({ lateCount: 1, counts: { paid: 1, preparing: 1, ready: 0, received: 0 } });
      const filtered = await attendant.get(`${base()}/orders/queue?status=preparing`);
      expect(filtered.body.items.map((o: { id: string }) => o.id)).toEqual([fresh.id]);
    });

    it('o ajuste de tempo muda o limite de atraso; não vaza pedidos de outra casa', async () => {
      const slow = await order('paid', [item()], undefined, new Date(Date.now() - 40 * 60_000));
      await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estB.id, status: 'paid', items: [{ menuItemId: world.itemB.id, name: 'Pilsen', unitPriceCents: 1000 }] });
      expect((await manager.patch(`${base()}/orders/${slow.id}/estimate`).set(CSRF).send({ minutes: 60 })).status).toBe(200);
      const res = await attendant.get(`${base()}/orders/queue`);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ late: false, estimatedMinutes: 60, estimateAdjusted: true });
    });
  });

  describe('ajuste de tempo (63)', () => {
    it('só o gestor ajusta, entre 1 e 240 min; o cliente vê o valor ajustado e sem ajuste vale o tempo médio', async () => {
      const o = await order('preparing');
      const url = `${base()}/orders/${o.id}/estimate`;
      expect((await attendant.patch(url).set(CSRF).send({ minutes: 20 })).status).toBe(403);
      for (const minutes of [0, 241, 1.5]) expect((await manager.patch(url).set(CSRF).send({ minutes })).status).toBe(400);
      const client = await login(t.browser(), world.client.email);
      expect((await client.get(`/api/orders/${o.id}`)).body.estimatedMinutes).toBe(15);
      expect((await manager.patch(url).set(CSRF).send({ minutes: 240 })).status).toBe(200);
      expect((await client.get(`/api/orders/${o.id}`)).body).toMatchObject({ estimatedMinutes: 240, estimateAdjusted: true });
      const done = await order('delivered');
      expect((await manager.patch(`${base()}/orders/${done.id}/estimate`).set(CSRF).send({ minutes: 5 })).status).toBe(422);
      const other = await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estB.id, items: [{ menuItemId: world.itemB.id, name: 'Pilsen', unitPriceCents: 1000 }] });
      expect((await manager.patch(`${base()}/orders/${other.id}/estimate`).set(CSRF).send({ minutes: 5 })).status).toBe(404);
    });
  });

  describe('estações da cozinha (24)', () => {
    async function station(name: string) {
      const res = await manager.post(`${base()}/kitchen-stations`).set(CSRF).send({ name });
      expect(res.status).toBe(201);
      return res.body as { id: string };
    }

    it('gestor cadastra estações (nome único); atendente não; item guarda a estação e ela vai para o pedido', async () => {
      const chapa = await station('Chapa');
      expect((await manager.post(`${base()}/kitchen-stations`).set(CSRF).send({ name: 'Chapa' })).status).toBe(409);
      expect((await attendant.post(`${base()}/kitchen-stations`).set(CSRF).send({ name: 'Bar' })).status).toBe(403);
      expect((await attendant.get(`${base()}/kitchen-stations`)).body).toHaveLength(1);
      const patched = await manager.patch(`${base()}/menu/items/${world.itemA.id}`).set(CSRF).send({ stationId: chapa.id });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ stationId: chapa.id, stationName: 'Chapa' });
      const foreign = await manager.patch(`${base()}/menu/items/${world.itemA.id}`).set(CSRF).send({ stationId: '6f1c0f7e-4f0e-4c52-9d3a-0d6b1c1f9a11' });
      expect(foreign.status).toBe(422);
      expect((await manager.patch(`${base()}/menu/items/${world.itemA.id}`).set(CSRF).send({ stationId: null })).body.stationId).toBeNull();
    });

    it('o pedido só vira pronto quando todas as estações terminaram (e Geral conta como estação)', async () => {
      const chapa = await station('Chapa');
      const bar = await station('Bar');
      const o = await order('paid', [item(chapa.id, 'Burger'), item(bar.id, 'Drink'), item(null, 'Batata')]);
      const advance = (status: string) => attendant.patch(`${base()}/orders/${o.id}/status`).set(CSRF).send({ status });
      expect((await advance('preparing')).status).toBe(200);
      // não dá para pular estações pelo avanço manual
      expect((await advance('ready')).body.code).toBe('STATIONS_PENDING');
      const mark = (stationId: string | null) => attendant.post(`${base()}/orders/${o.id}/items/ready`).set(CSRF).send({ stationId });
      let res = await mark(chapa.id);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('preparing');
      expect((await mark(chapa.id)).status).toBe(200); // idempotente
      res = await mark(bar.id);
      expect(res.body.status).toBe('preparing');
      res = await mark(null);
      expect(res.body.status).toBe('ready');
      expect(res.body.items.every((i: { readyAt: string | null }) => i.readyAt)).toBe(true);
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: o.id } })).readyAt).not.toBeNull();
    });

    it('filtra a fila por estação (itens da estação e "general"), e valida a estação do pedido', async () => {
      const chapa = await station('Chapa');
      const o = await order('preparing', [item(chapa.id, 'Burger'), item(null, 'Batata')]);
      const chapaView = await attendant.get(`${base()}/orders/queue?stationId=${chapa.id}`);
      expect(chapaView.body.items[0].items.map((i: { name: string }) => i.name)).toEqual(['Burger']);
      const general = await attendant.get(`${base()}/orders/queue?stationId=general`);
      expect(general.body.items[0].items.map((i: { name: string }) => i.name)).toEqual(['Batata']);
      const other = await station('Bar');
      expect((await attendant.get(`${base()}/orders/queue?stationId=${other.id}`)).body.items).toHaveLength(0);
      expect((await attendant.post(`${base()}/orders/${o.id}/items/ready`).set(CSRF).send({ stationId: other.id })).status).toBe(422);
      const paid = await order('paid', [item()]);
      expect((await attendant.post(`${base()}/orders/${paid.id}/items/ready`).set(CSRF).send({ stationId: null })).status).toBe(422);
    });

    it('sem estação nomeada o avanço manual para pronto continua valendo', async () => {
      const o = await order('preparing');
      const res = await attendant.patch(`${base()}/orders/${o.id}/status`).set(CSRF).send({ status: 'ready' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
    });

    it('excluir a estação devolve os itens à Geral', async () => {
      const chapa = await station('Chapa');
      await manager.patch(`${base()}/menu/items/${world.itemA.id}`).set(CSRF).send({ stationId: chapa.id });
      expect((await manager.delete(`${base()}/kitchen-stations/${chapa.id}`).set(CSRF)).status).toBe(204);
      expect((await t.prisma.menuItem.findUniqueOrThrow({ where: { id: world.itemA.id } })).stationId).toBeNull();
    });
  });

  describe('impressora offline (26)', () => {
    async function printer(name = 'Cozinha') {
      const res = await manager.post(`${base()}/printers`).set(CSRF).send({ name });
      expect(res.status).toBe(201);
      return res.body as { id: string; deviceKey: string };
    }

    it('heartbeat do dispositivo mantém online; sem sinal por 60 s abre UM alerta; voltar o resolve', async () => {
      const p = await printer();
      expect(p.deviceKey).toMatch(/^pk_/);
      const service = t.app.get(PrintersService);
      expect((await t.browser().post('/api/printers/heartbeat').set('X-Printer-Key', p.deviceKey)).status).toBe(204);
      expect((await manager.get(`${base()}/printers`)).body[0]).toMatchObject({ online: true });
      expect(await service.checkOffline(new Date())).toBe(0);

      const later = new Date(Date.now() + PRINTER_OFFLINE_AFTER_MS + 1000);
      expect(await service.checkOffline(later)).toBe(1);
      expect(await service.checkOffline(new Date(later.getTime() + 5000))).toBe(0); // sem repetir enquanto aberto
      const alerts = await manager.get(`${base()}/alerts`);
      expect(alerts.body).toHaveLength(1);
      expect(alerts.body[0]).toMatchObject({ kind: 'printer_offline', refId: p.id });
      expect((await attendant.get(`${base()}/alerts`)).body).toHaveLength(1); // atendente vê alerta de impressora

      expect((await t.browser().post('/api/printers/heartbeat').set('X-Printer-Key', p.deviceKey)).status).toBe(204);
      expect((await manager.get(`${base()}/alerts`)).body).toHaveLength(0);
    });

    it('chave inválida é recusada; nome único; só o gestor cadastra; simulação pelo painel', async () => {
      const p = await printer();
      expect((await t.browser().post('/api/printers/heartbeat').set('X-Printer-Key', 'pk_errada')).status).toBe(401);
      expect((await t.browser().post('/api/printers/heartbeat')).status).toBe(401);
      expect((await manager.post(`${base()}/printers`).set(CSRF).send({ name: 'Cozinha' })).status).toBe(409);
      expect((await attendant.post(`${base()}/printers`).set(CSRF).send({ name: 'Bar' })).status).toBe(403);
      const sim = await manager.post(`${base()}/printers/${p.id}/heartbeat`).set(CSRF);
      expect(sim.body).toMatchObject({ id: p.id, online: true });
      expect((await t.prisma.printer.findUniqueOrThrow({ where: { id: p.id } })).keyHash).not.toContain('pk_');
    });

    it('impressora nunca vista só é offline depois de 60 s da criação e o alerta chega por tempo real', async () => {
      const p = await printer();
      const service = t.app.get(PrintersService);
      expect(await service.checkOffline(new Date())).toBe(0);
      const list = await manager.get(`${base()}/printers`);
      expect(list.body[0]).toMatchObject({ id: p.id, online: false, lastSeenAt: null });
      expect(await service.checkOffline(new Date(Date.now() + PRINTER_OFFLINE_AFTER_MS + 1000))).toBe(1);
    });
  });

  describe('turno e histórico (25)', () => {
    it('gestor abre e fecha; um turno aberto por vez; histórico com entregues e cancelados do período', async () => {
      expect((await manager.get(`${base()}/shift/current`)).body).toEqual({ shift: null });
      expect((await attendant.post(`${base()}/shift/open`).set(CSRF)).status).toBe(403);
      const opened = await manager.post(`${base()}/shift/open`).set(CSRF);
      expect(opened.status).toBe(200);
      expect((await manager.post(`${base()}/shift/open`).set(CSRF)).body.code).toBe('SHIFT_ALREADY_OPEN');

      const before = await order('delivered', [item()], { deliveredAt: new Date(Date.now() - 3600_000) });
      const o1 = await order('paid');
      for (const status of ['preparing', 'ready', 'delivered']) {
        expect((await attendant.patch(`${base()}/orders/${o1.id}/status`).set(CSRF).send({ status })).status).toBe(200);
      }
      await order('cancelled', [item()], { cancelledAt: new Date() });
      const closed = await manager.post(`${base()}/shift/close`).set(CSRF);
      expect(closed.status).toBe(200);
      expect(closed.body.totals).toEqual({ deliveredCount: 1, cancelledCount: 1, deliveredCents: 2000, refundedCents: 2000 });
      expect(closed.body.orders.map((o: { id: string }) => o.id)).not.toContain(before.id);
      expect((await manager.post(`${base()}/shift/close`).set(CSRF)).body.code).toBe('NO_OPEN_SHIFT');
      const list = await attendant.get(`${base()}/shifts`);
      expect(list.body.total).toBe(1);
      const detail = await attendant.get(`${base()}/shifts/${list.body.items[0].id}`);
      expect(detail.body.totals.deliveredCount).toBe(1);
      expect((await manager.get(`/api/establishments/${world.estB.id}/shifts/${list.body.items[0].id}`)).status).toBe(403);
    });
  });
});
