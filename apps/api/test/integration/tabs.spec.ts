import { resetDatabase } from '../helpers/database.js';
import { FakePaymentGateway } from '../helpers/fake-gateway.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, seedOrder, verifyEmail } from '../helpers/orders.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

describe('Sprint 3 — comandas e fechamento (fichas 17 e 22)', () => {
  let t: TestApp;
  let gateway: FakePaymentGateway;
  let world: World;
  let tableId: string;
  let planId: string;
  let attendant: Agent;
  const base = () => `/api/establishments/${world.estA.id}`;
  const card = { method: 'credit', cardToken: 'tok_test_123456', paymentMethodId: 'visa' };
  let keySeq = 0;
  const key = () => `close-key-${++keySeq}-abcdefgh`;

  beforeAll(async () => {
    gateway = new FakePaymentGateway();
    t = await createTestApp(undefined, gateway);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    const orders = await createOrdersWorld(t.prisma, world);
    tableId = orders.tableA.id;
    planId = orders.tableA.floorPlanId;
    await verifyEmail(t.prisma, world.client.id);
    attendant = await login(t.browser(), world.attendantA.email);
    gateway.reset();
    keySeq = 0;
  });

  const occupy = (id = tableId) => t.prisma.diningTable.update({ where: { id }, data: { occupancy: 'occupied', occupiedSince: new Date() } });
  const order = (price: number, over: Parameters<typeof seedOrder>[1] extends infer T ? Partial<T> : never = {}) =>
    seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'received', tableId, items: [{ menuItemId: world.itemA.id, name: 'IPA', unitPriceCents: price }], ...over });
  const open = async (id = tableId) => (await attendant.post(`${base()}/tables/${id}/tab`).set(CSRF)).body as { id: string };
  const assign = (tabId: string, orderId: string) => attendant.post(`${base()}/tabs/${tabId}/orders`).set(CSRF).send({ orderId });
  const close = (tabId: string, body: object = {}) => attendant.post(`${base()}/tabs/${tabId}/close`).set(CSRF).send({ idempotencyKey: key(), ...card, ...body });

  describe('abrir comanda e atribuir pedidos (17)', () => {
    it('uma comanda aberta por mesa; repetir devolve a mesma; só equipe com tabs.manage', async () => {
      const first = await attendant.post(`${base()}/tables/${tableId}/tab`).set(CSRF);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ label: 'Mesa 1', status: 'open', totalCents: 0, balanceCents: 0 });
      expect((await open()).id).toBe(first.body.id);
      expect(await t.prisma.tab.count()).toBe(1);
      const client = await login(t.browser(), world.client.email);
      expect((await client.post(`${base()}/tables/${tableId}/tab`).set(CSRF)).status).toBe(403);
      const managerB = await login(t.browser(), world.managerB.email);
      expect((await managerB.post(`${base()}/tables/${tableId}/tab`).set(CSRF)).status).toBe(403);
      expect((await attendant.post(`${base()}/tables/6f1c0f7e-4f0e-4c52-9d3a-0d6b1c1f9a11/tab`).set(CSRF)).status).toBe(404);
    });

    it('mesas mescladas compartilham uma só comanda (a mesa não importa)', async () => {
      const second = await t.prisma.diningTable.create({ data: { floorPlanId: planId, establishmentId: world.estA.id, label: 'Mesa 2', shape: 'square', capacity: 4, positionX: 30, positionY: 10, qrCode: 'BARA-2222' } });
      const manager = await login(t.browser(), world.managerA.email);
      expect((await manager.post(`${base()}/table-groups`).set(CSRF).send({ tableIds: [tableId, second.id] })).status).toBe(201);
      const a = await open(tableId);
      const b = await open(second.id);
      expect(b.id).toBe(a.id);
      const tab = (await attendant.get(`${base()}/tabs/${a.id}`)).body;
      expect(tab.label).toBe('Mesa 1 + Mesa 2');
      expect(tab.tableIds.sort()).toEqual([tableId, second.id].sort());
      const o = await order(1000, { tableId: second.id });
      expect((await assign(a.id, o.id)).status).toBe(200);
    });

    it('pedido atribuído fica "na comanda": não é pago, entra na fila e vai para o preparo sem cobrança', async () => {
      const tab = await open();
      const o = await order(2500);
      const res = await assign(tab.id, o.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalCents: 2500, paidCents: 0, balanceCents: 2500 });
      expect(res.body.orders[0]).toMatchObject({ status: 'received', settlement: 'on_tab' });
      const queue = await attendant.get(`${base()}/orders/queue`);
      expect(queue.body.items[0]).toMatchObject({ id: o.id, settlement: 'on_tab', status: 'received' });
      expect(queue.body.counts.received).toBe(1);
      const next = await attendant.patch(`${base()}/orders/${o.id}/status`).set(CSRF).send({ status: 'preparing' });
      expect(next.status).toBe(200);
      expect(next.body).toMatchObject({ status: 'preparing', settlement: 'on_tab', tabId: tab.id });
      expect(await t.prisma.payment.count()).toBe(0);
      // sem comanda, pedido não pago continua fora da cozinha
      const loose = await order(1000);
      expect((await attendant.patch(`${base()}/orders/${loose.id}/status`).set(CSRF).send({ status: 'preparing' })).status).toBe(422);
    });

    it('recusa pedido de outra mesa, de outra casa, cancelado, já em outra comanda ou com Pix pendente', async () => {
      const tab = await open();
      const other = await t.prisma.diningTable.create({ data: { floorPlanId: planId, establishmentId: world.estA.id, label: 'Mesa 7', shape: 'square', capacity: 4, positionX: 50, positionY: 10, qrCode: 'BARA-7777' } });
      const elsewhere = await order(1000, { tableId: other.id });
      expect((await assign(tab.id, elsewhere.id)).body.code).toBe('ORDER_NOT_ON_TAB_TABLE');
      const foreign = await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estB.id, status: 'received', items: [{ menuItemId: world.itemB.id, name: 'x', unitPriceCents: 100 }] });
      expect((await assign(tab.id, foreign.id)).status).toBe(404);
      const cancelled = await order(1000, { status: 'cancelled', withPayment: false });
      expect((await assign(tab.id, cancelled.id)).body.code).toBe('ORDER_CANCELLED');
      const pending = await order(1000);
      await t.prisma.payment.create({ data: { orderId: pending.id, attempt: 1, method: 'pix', status: 'pending', amountCents: 1000, providerPaymentId: 'p-1' } });
      expect((await assign(tab.id, pending.id)).body.code).toBe('ORDER_HAS_PENDING_PAYMENT');
      const o = await order(1000);
      const tab2 = await t.prisma.tab.create({ data: { establishmentId: world.estA.id, scopeKey: other.id, label: 'x' } });
      await t.prisma.order.update({ where: { id: o.id }, data: { tabId: tab2.id } });
      expect((await assign(tab.id, o.id)).body.code).toBe('ORDER_ALREADY_ON_TAB');
    });

    it('só sai da comanda o pedido ainda não iniciado', async () => {
      const tab = await open();
      const o = await order(1000);
      await assign(tab.id, o.id);
      expect((await attendant.delete(`${base()}/tabs/${tab.id}/orders/${o.id}`).set(CSRF)).body.orders).toHaveLength(0);
      await assign(tab.id, o.id);
      await attendant.patch(`${base()}/orders/${o.id}/status`).set(CSRF).send({ status: 'preparing' });
      expect((await attendant.delete(`${base()}/tabs/${tab.id}/orders/${o.id}`).set(CSRF)).body.code).toBe('ORDER_ALREADY_STARTED');
    });
  });

  describe('fechar e pagar (22)', () => {
    async function scenario() {
      await occupy();
      const tab = await open();
      const paid = await order(3000, { status: 'paid', paidAt: new Date() }); // já pago individualmente
      const onTab = await order(2000);
      const cancelled = await order(9999, { status: 'cancelled', withPayment: false, data: { cancelledAt: new Date() } });
      for (const o of [paid, onTab, cancelled]) if (o.status !== 'cancelled') await assign(tab.id, o.id);
      await t.prisma.order.update({ where: { id: cancelled.id }, data: { tabId: tab.id } });
      return { tab, paid, onTab, cancelled };
    }

    it('mostra total, pago e saldo; cancelados saem do total', async () => {
      const { tab } = await scenario();
      const view = (await attendant.get(`${base()}/tabs/${tab.id}`)).body;
      expect(view).toMatchObject({ totalCents: 5000, paidCents: 3000, balanceCents: 2000 });
      expect(view.orders.map((o: { settlement: string }) => o.settlement).sort()).toEqual(['on_tab', 'paid', 'unpaid']);
    });

    it('cobra SÓ o saldo, quita os pedidos, fecha a comanda e libera a mesa', async () => {
      const { tab, paid, onTab } = await scenario();
      const res = await close(tab.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ chargedCents: 2000, replayed: false });
      expect(res.body.tab).toMatchObject({ status: 'closed', balanceCents: 0, paidCents: 5000 });
      expect(gateway.created).toHaveLength(1);
      expect(gateway.created[0]).toMatchObject({ amountCents: 2000, method: 'credit' });
      const settled = await t.prisma.order.findUniqueOrThrow({ where: { id: onTab.id } });
      expect(settled.tabSettledAt).not.toBeNull();
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: paid.id } })).tabSettledAt).toBeNull(); // o pago antes nunca é cobrado de novo
      expect(await t.prisma.payment.count()).toBe(1); // nenhum pagamento novo de pedido
      expect((await t.prisma.diningTable.findUniqueOrThrow({ where: { id: tableId } })).occupancy).toBe('free');
      const tabRow = await t.prisma.tab.findUniqueOrThrow({ where: { id: tab.id } });
      expect(tabRow).toMatchObject({ closedTotalCents: 5000, closedPaidBeforeCents: 3000, closedChargedCents: 2000 });
      // a mesa pode abrir nova comanda depois
      expect((await open()).id).not.toBe(tab.id);
    });

    it('é idempotente: repetir a chave devolve o mesmo resultado sem cobrar de novo; outra chave após fechar = 409', async () => {
      const { tab } = await scenario();
      const body = { idempotencyKey: 'same-key-12345' };
      expect((await close(tab.id, body)).body.replayed).toBe(false);
      const again = await close(tab.id, body);
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ replayed: true, chargedCents: 2000 });
      expect(gateway.charges).toBe(1);
      expect(await t.prisma.tabPayment.count()).toBe(1);
      const other = await close(tab.id);
      expect(other.status).toBe(409);
      expect(other.body.code).toBe('TAB_CLOSED');
    });

    it('fechamentos simultâneos cobram uma única vez (lock + índice parcial)', async () => {
      const { tab } = await scenario();
      const results = await Promise.all([close(tab.id), close(tab.id), close(tab.id)]);
      expect(results.filter(r => r.status === 200)).toHaveLength(1);
      expect(results.filter(r => r.status !== 200).every(r => r.status === 409)).toBe(true);
      expect(gateway.charges).toBe(1);
      expect(await t.prisma.tabPayment.count({ where: { status: 'approved' } })).toBe(1);
    });

    it('cartão recusado mantém a comanda aberta, sem quitar pedidos; uma nova chave pode pagar', async () => {
      const { tab, onTab } = await scenario();
      gateway.cardResult = 'refused';
      const refused = await close(tab.id);
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('PAYMENT_REFUSED');
      expect((await t.prisma.tab.findUniqueOrThrow({ where: { id: tab.id } })).status).toBe('open');
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: onTab.id } })).tabSettledAt).toBeNull();
      gateway.cardResult = 'approved';
      const ok = await close(tab.id);
      expect(ok.status).toBe(200);
      expect(ok.body.tab.status).toBe('closed');
    });

    it('falha do gateway antes de cobrar é erro 502 (nunca sucesso) e permite tentar de novo', async () => {
      const { tab } = await scenario();
      gateway.createFailure = 'not_processed';
      const failed = await close(tab.id);
      expect(failed.status).toBe(502);
      expect((await t.prisma.tab.findUniqueOrThrow({ where: { id: tab.id } })).status).toBe('open');
      expect((await close(tab.id)).status).toBe(200);
      expect(gateway.charges).toBe(1);
    });

    it('resultado incerto (cobrou e a resposta se perdeu) é conciliado pela mesma chave, sem cobrar duas vezes', async () => {
      const { tab } = await scenario();
      gateway.createFailure = 'timeout_after_charge';
      gateway.searchFails = true;
      const body = { idempotencyKey: 'uncertain-key-1' };
      const first = await close(tab.id, body);
      expect(first.status).toBe(502);
      expect((await t.prisma.tab.findUniqueOrThrow({ where: { id: tab.id } })).status).toBe('open');
      await t.prisma.tabPayment.updateMany({ data: { createdAt: new Date(Date.now() - 60_000) } });
      gateway.searchFails = false;
      const retry = await close(tab.id, body);
      expect(retry.status).toBe(200);
      expect(retry.body.tab.status).toBe('closed');
      expect(gateway.charges).toBe(1);
    });

    it('saldo zero fecha sem chamar o gateway; Pix e cartão ausente são recusados', async () => {
      const tab = await open();
      const paid = await order(1000, { status: 'paid', paidAt: new Date() });
      await assign(tab.id, paid.id);
      const res = await close(tab.id, { cardToken: undefined, paymentMethodId: undefined });
      expect(res.status).toBe(200);
      expect(res.body.chargedCents).toBe(0);
      expect(gateway.created).toHaveLength(0);

      const tab2 = await open();
      const o = await order(1000);
      await assign(tab2.id, o.id);
      expect((await close(tab2.id, { method: 'pix' })).body.code).toBe('TAB_PAYMENT_METHOD_UNSUPPORTED');
      expect((await close(tab2.id, { cardToken: undefined })).body.code).toBe('CARD_REQUIRED');
      expect((await attendant.post(`${base()}/tabs/${tab2.id}/close`).set(CSRF).send({ ...card })).status).toBe(400); // sem chave
    });

    it('sem gateway o fechamento com saldo é 503; comanda de outra casa é 404', async () => {
      const { tab } = await scenario();
      gateway.available = false;
      expect((await close(tab.id)).status).toBe(503);
      gateway.available = true;
      const managerB = await login(t.browser(), world.managerB.email);
      await t.prisma.userPermission.create({ data: { userId: world.managerB.id, permission: 'tabs.manage' } }).catch(() => undefined);
      expect((await managerB.get(`/api/establishments/${world.estB.id}/tabs/${tab.id}`)).status).toBe(404);
    });

    it('pedido pago individualmente depois de atribuído continua sem ser cobrado de novo no fechamento', async () => {
      const tab = await open();
      const o = await order(2000);
      await assign(tab.id, o.id);
      const client = await login(t.browser(), world.client.email);
      const pay = await client.post(`/api/orders/${o.id}/payments`).set(CSRF).send(card);
      expect(pay.status).toBe(201);
      expect(pay.body.status).toBe('paid');
      expect((await attendant.get(`${base()}/tabs/${tab.id}`)).body).toMatchObject({ totalCents: 2000, paidCents: 2000, balanceCents: 0 });
      const res = await close(tab.id);
      expect(res.body.chargedCents).toBe(0);
      expect(gateway.charges).toBe(1); // só a cobrança individual
    });

    it('pedido entregue da comanda só rende pontos depois de quitado', async () => {
      const tab = await open();
      const o = await order(5000);
      await assign(tab.id, o.id);
      for (const status of ['preparing', 'ready', 'delivered']) {
        expect((await attendant.patch(`${base()}/orders/${o.id}/status`).set(CSRF).send({ status })).status).toBe(200);
      }
      const client = await login(t.browser(), world.client.email);
      expect((await client.get('/api/me/loyalty')).body.balancePoints).toBe(0);
      expect((await close(tab.id)).status).toBe(200);
      expect((await client.get('/api/me/loyalty')).body.balancePoints).toBe(50);
    });
  });
});
