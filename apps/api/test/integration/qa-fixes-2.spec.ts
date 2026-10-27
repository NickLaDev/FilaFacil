import { PRINTER_OFFLINE_AFTER_MS } from '@filafacil/shared';
import { PrintersService } from '../../src/modules/kitchen/printers.service.js';
import { ReadyNotifierService } from '../../src/modules/orders/ready-notifier.service.js';
import { resetDatabase } from '../helpers/database.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, seedOrder, verifyEmail } from '../helpers/orders.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

describe('Sprint 3 — correções do QA (M3, B1, B2, B4)', () => {
  let t: TestApp;
  let world: World;
  let tableId: string;
  let client: Agent;
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
    tableId = (await createOrdersWorld(t.prisma, world)).tableA.id;
    await verifyEmail(t.prisma, world.client.id);
    client = await login(t.browser(), world.client.email);
    manager = await login(t.browser(), world.managerA.email);
    attendant = await login(t.browser(), world.attendantA.email);
    t.email.messages.length = 0;
  });

  const preparing = (price = 2000) =>
    seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'preparing', tableId, items: [{ menuItemId: world.itemA.id, name: 'IPA', unitPriceCents: price }] });
  const step = (id: string, status: string) => attendant.patch(`${base()}/orders/${id}/status`).set(CSRF).send({ status });
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  describe('M3 — aviso de pronto fora do caminho da requisição', () => {
    it('SMTP lento não prende a resposta ao cozinheiro e o envio conclui em segundo plano', async () => {
      const original = t.email.send.bind(t.email);
      t.email.send = async (...args) => {
        await sleep(2200);
        return original(...args);
      };
      try {
        const order = await preparing();
        const started = Date.now();
        expect((await step(order.id, 'ready')).status).toBe(200);
        expect(Date.now() - started).toBeLessThan(2000);
        const during = await t.prisma.orderNotification.findFirstOrThrow({ where: { orderId: order.id, channel: 'email' } });
        expect(during.errorCode).toBe('in_flight'); // reservado, ainda enviando
        await sleep(1200);
        const done = await t.prisma.orderNotification.findFirstOrThrow({ where: { orderId: order.id, channel: 'email' } });
        expect(done).toMatchObject({ status: 'sent', errorCode: null });
        expect(t.email.messages).toHaveLength(1);
      } finally {
        t.email.send = original;
      }
    });

    it('reserva que ficou presa (processo caiu) vira failed/interrupted sem reenviar e sem mexer nas recentes', async () => {
      const order = await preparing();
      const row = (channel: string, minutesAgo: number) =>
        t.prisma.orderNotification.create({ data: { orderId: order.id, channel, status: 'skipped', provider: 'x', errorCode: 'in_flight', createdAt: new Date(Date.now() - minutesAgo * 60_000) } });
      const stuck = await row('email', 5);
      const fresh = await row('sms', 0);
      expect(await t.app.get(ReadyNotifierService).recoverStuck()).toBe(1);
      expect(await t.prisma.orderNotification.findUniqueOrThrow({ where: { id: stuck.id } })).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
      expect(await t.prisma.orderNotification.findUniqueOrThrow({ where: { id: fresh.id } })).toMatchObject({ status: 'skipped', errorCode: 'in_flight' });
      expect(t.email.messages).toHaveLength(0);
    });
  });

  describe('B1 — ruptura de estoque sinalizada', () => {
    it('consumo maior que o estoque trunca em zero, registra a falta e alerta o gestor até a reposição', async () => {
      const malte = await t.prisma.ingredient.create({ data: { establishmentId: world.estA.id, name: 'Malte', unit: 'g', unitCost: '0.01', stockQuantity: '100', minStockQuantity: '0' } });
      const sheet = await t.prisma.technicalSheet.create({ data: { menuItemId: world.itemA.id, costLimitPercent: '40' } });
      await t.prisma.technicalSheetItem.create({ data: { technicalSheetId: sheet.id, ingredientId: malte.id, quantity: '300' } });
      const order = await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'paid', items: [{ menuItemId: world.itemA.id, name: 'IPA', unitPriceCents: 2000 }] });
      expect((await step(order.id, 'preparing')).status).toBe(200);
      const movement = await t.prisma.stockMovement.findFirstOrThrow({ where: { orderId: order.id } });
      expect(movement.quantity.toString()).toBe('-100');
      expect(movement.shortfall.toString()).toBe('200');
      const alerts = (await manager.get(`${base()}/alerts`)).body as { kind: string; message: string }[];
      expect(alerts.map(a => a.kind).sort()).toEqual(['low_stock', 'stock_shortfall']);
      expect(alerts.find(a => a.kind === 'stock_shortfall')?.message).toContain('faltou 200.00 g de Malte');
      expect((await attendant.get(`${base()}/alerts`)).body).toHaveLength(0);
      await manager.put(`${base()}/ingredients/${malte.id}/stock`).set(CSRF).send({ stockQuantity: 5000, minStockQuantity: 100 });
      expect((await manager.get(`${base()}/alerts`)).body).toHaveLength(0);
    });

    it('sem falta não há alerta de ruptura', async () => {
      const malte = await t.prisma.ingredient.create({ data: { establishmentId: world.estA.id, name: 'Malte', unit: 'g', unitCost: '0.01', stockQuantity: '1000', minStockQuantity: '0' } });
      const sheet = await t.prisma.technicalSheet.create({ data: { menuItemId: world.itemA.id, costLimitPercent: '40' } });
      await t.prisma.technicalSheetItem.create({ data: { technicalSheetId: sheet.id, ingredientId: malte.id, quantity: '300' } });
      const order = await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'paid', items: [{ menuItemId: world.itemA.id, name: 'IPA', unitPriceCents: 2000 }] });
      await step(order.id, 'preparing');
      expect((await t.prisma.stockMovement.findFirstOrThrow({ where: { orderId: order.id } })).shortfall.toString()).toBe('0');
      expect(await t.prisma.staffAlert.count({ where: { kind: 'stock_shortfall' } })).toBe(0);
    });
  });

  describe('B2 — alerta dispensado fica silenciado até a condição normalizar', () => {
    it('impressora: dispensar some do painel e não reabre no ciclo seguinte; ao voltar e cair de novo, alerta novo', async () => {
      const printer = (await manager.post(`${base()}/printers`).set(CSRF).send({ name: 'Cozinha' })).body as { id: string; deviceKey: string };
      const service = t.app.get(PrintersService);
      const later = new Date(Date.now() + PRINTER_OFFLINE_AFTER_MS + 1000);
      expect(await service.checkOffline(later)).toBe(1);
      const alert = (await manager.get(`${base()}/alerts`)).body[0] as { id: string };
      expect((await manager.post(`${base()}/alerts/${alert.id}/dismiss`).set(CSRF)).status).toBe(204);
      expect((await manager.get(`${base()}/alerts`)).body).toHaveLength(0);
      expect(await service.checkOffline(new Date(later.getTime() + 20_000))).toBe(0); // não reabre
      expect((await manager.get(`${base()}/alerts`)).body).toHaveLength(0);

      await t.browser().post('/api/printers/heartbeat').set('X-Printer-Key', printer.deviceKey);
      expect(await service.checkOffline(new Date(Date.now() + PRINTER_OFFLINE_AFTER_MS + 5000))).toBe(1);
      expect((await manager.get(`${base()}/alerts`)).body).toHaveLength(1);
    });

    it('estoque baixo: dispensar silencia novas baixas; repor e cair de novo abre outro; estorno pendente não se dispensa', async () => {
      const malte = await t.prisma.ingredient.create({ data: { establishmentId: world.estA.id, name: 'Malte', unit: 'g', unitCost: '0.01', stockQuantity: '500', minStockQuantity: '300' } });
      const sheet = await t.prisma.technicalSheet.create({ data: { menuItemId: world.itemA.id, costLimitPercent: '40' } });
      await t.prisma.technicalSheetItem.create({ data: { technicalSheetId: sheet.id, ingredientId: malte.id, quantity: '100' } });
      const prepare = async () => step((await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'paid', items: [{ menuItemId: world.itemA.id, name: 'IPA', unitPriceCents: 2000 }] })).id, 'preparing');
      await prepare(); // 400
      await prepare(); // 300 ≤ 300 → alerta
      const alert = (await manager.get(`${base()}/alerts`)).body[0] as { id: string };
      expect((await manager.post(`${base()}/alerts/${alert.id}/dismiss`).set(CSRF)).status).toBe(204);
      await prepare(); // 200: continua baixo, mas dispensado
      expect((await manager.get(`${base()}/alerts`)).body).toHaveLength(0);
      await manager.put(`${base()}/ingredients/${malte.id}/stock`).set(CSRF).send({ stockQuantity: 400, minStockQuantity: 300 });
      await prepare(); // 300 ≤ 300 de novo → novo alerta
      expect((await manager.get(`${base()}/alerts`)).body).toHaveLength(1);

      const tab = await t.prisma.tab.create({ data: { establishmentId: world.estA.id, scopeKey: tableId, label: 'Mesa 1' } });
      const payment = await t.prisma.tabPayment.create({ data: { tabId: tab.id, idempotencyKey: 'k-refund-1', method: 'credit', amountCents: 100, status: 'cancelled', failureReason: 'refund_pending', providerPaymentId: 'x-1' } });
      await t.prisma.staffAlert.create({ data: { establishmentId: world.estA.id, kind: 'tab_refund_pending', refId: payment.id, message: 'x' } });
      const pending = (await attendant.get(`${base()}/alerts`)).body[0] as { id: string };
      const res = await attendant.post(`${base()}/alerts/${pending.id}/dismiss`).set(CSRF);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ALERT_NOT_DISMISSIBLE');
    });
  });

  describe('B4 — chamados de garçom não dependem do recurso planta do plano', () => {
    it('sem floor_plan no plano a equipe ainda vê e atende os chamados (o mapa continua restrito)', async () => {
      const call = (await client.post('/api/table-calls').set(CSRF).send({ tableId })).body as { id: string };
      await t.prisma.planFeatureGrant.deleteMany({ where: { plan: { name: 'Business' }, feature: 'floor_plan' } });
      expect((await attendant.get(`${base()}/table-map`)).status).toBe(403);
      const open = await attendant.get(`${base()}/table-calls`);
      expect(open.status).toBe(200);
      expect(open.body).toHaveLength(1);
      expect((await attendant.post(`${base()}/table-calls/${call.id}/resolve`).set(CSRF)).status).toBe(204);
      expect((await client.get(`/api/table-calls/${call.id}`)).body.resolvedAt).not.toBeNull();
    });
  });
});
