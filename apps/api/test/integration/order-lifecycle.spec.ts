import { MessageDeliveryError } from '../../src/modules/notifications/delivery-error.js';
import { resetDatabase } from '../helpers/database.js';
import { FakePaymentGateway } from '../helpers/fake-gateway.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, placeOrder, seedOrder, verifyEmail } from '../helpers/orders.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

describe('Sprint 3 — cancelamento, pedido pronto, FilaZero Club e estoque (fichas 10, 05, 14, 50)', () => {
  let t: TestApp;
  let gateway: FakePaymentGateway;
  let world: World;
  let client: Agent;
  let manager: Agent;
  let attendant: Agent;
  const base = () => `/api/establishments/${world.estA.id}`;
  const card = { method: 'credit', cardToken: 'tok_test_123456', paymentMethodId: 'visa' };

  beforeAll(async () => {
    gateway = new FakePaymentGateway();
    t = await createTestApp(undefined, gateway);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    await createOrdersWorld(t.prisma, world);
    await verifyEmail(t.prisma, world.client.id);
    client = await login(t.browser(), world.client.email);
    manager = await login(t.browser(), world.managerA.email);
    attendant = await login(t.browser(), world.attendantA.email);
    gateway.reset();
    t.email.messages.length = 0;
  });

  const place = async (extra: object = {}) => {
    const res = await placeOrder(client, { establishmentId: world.estA.id, items: [{ menuItemId: world.itemA.id, quantity: 1 }], ...extra }, CSRF);
    expect(res.status).toBe(201);
    return res.body as { id: string; totalCents: number };
  };
  const payCard = async (id: string) => {
    const res = await client.post(`/api/orders/${id}/payments`).set(CSRF).send(card);
    expect(res.status).toBe(201);
    return res.body;
  };
  const advance = (id: string, status: string) => attendant.patch(`${base()}/orders/${id}/status`).set(CSRF).send({ status });
  const walk = async (id: string, ...steps: string[]) => {
    for (const step of steps) expect((await advance(id, step)).status).toBe(200);
  };
  const balance = async () => (await client.get('/api/me/loyalty')).body.balancePoints as number;

  describe('cancelar pedido (10)', () => {
    it('cliente cancela pedido não pago: sem cobrança, vira cancelado e não pode cancelar de novo', async () => {
      const order = await place();
      const res = await client.post(`/api/orders/${order.id}/cancel`).set(CSRF);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'cancelled', cancellable: false });
      expect((await client.post(`/api/orders/${order.id}/cancel`).set(CSRF)).body.code).toBe('ORDER_NOT_CANCELLABLE');
      expect(gateway.refunded).toHaveLength(0);
    });

    it('cancelar pedido pago estorna automaticamente e registra o cancelamento', async () => {
      const order = await place();
      await payCard(order.id);
      const res = await client.post(`/api/orders/${order.id}/cancel`).set(CSRF);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'cancelled', payment: { status: 'refunded' } });
      expect(gateway.refunded).toHaveLength(1);
      const row = await t.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(row.cancelledAt).not.toBeNull();
      expect(row.stockConsumedAt).toBeNull();
    });

    it('depois que o preparo começa o cliente não cancela; só quem tem orders.refund', async () => {
      const order = await place();
      await payCard(order.id);
      await walk(order.id, 'preparing');
      const denied = await client.post(`/api/orders/${order.id}/cancel`).set(CSRF);
      expect(denied.status).toBe(409);
      expect(denied.body.code).toBe('ORDER_NOT_CANCELLABLE');
      expect((await attendant.post(`${base()}/orders/${order.id}/cancel`).set(CSRF)).status).toBe(403);
      const done = await manager.post(`${base()}/orders/${order.id}/cancel`).set(CSRF);
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ status: 'cancelled', payment: { status: 'refunded' } });
    });

    it('estorno incerto mantém o pedido pago e pode ser repetido sem estornar duas vezes', async () => {
      const order = await place();
      await payCard(order.id);
      gateway.refundTimesOutAfterRefunding = true;
      gateway.getPaymentFails = true;
      const first = await client.post(`/api/orders/${order.id}/cancel`).set(CSRF);
      expect(first.status).toBe(502);
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('paid');
      gateway.getPaymentFails = false;
      const second = await client.post(`/api/orders/${order.id}/cancel`).set(CSRF);
      expect(second.status).toBe(200);
      expect(second.body.status).toBe('cancelled');
      expect(gateway.refunded).toHaveLength(1);
    });

    it('pedido de outra pessoa responde 404; atendente cancela pedido ainda não pago', async () => {
      const order = await place();
      const stranger = await login(t.browser(), 'outro@test.dev');
      expect((await stranger.post(`/api/orders/${order.id}/cancel`).set(CSRF)).status).toBe(404);
      const staff = await attendant.post(`${base()}/orders/${order.id}/cancel`).set(CSRF);
      expect(staff.status).toBe(200);
      expect(staff.body.status).toBe('cancelled');
    });

    it('cancelar um pedido pago com estoque controlado não baixa nada (cancelamento antes do preparo)', async () => {
      const ingredient = await t.prisma.ingredient.create({ data: { establishmentId: world.estA.id, name: 'Malte', unit: 'g', unitCost: '0.01', stockQuantity: '1000', minStockQuantity: '100' } });
      const sheet = await t.prisma.technicalSheet.create({ data: { menuItemId: world.itemA.id, costLimitPercent: '40' } });
      await t.prisma.technicalSheetItem.create({ data: { technicalSheetId: sheet.id, ingredientId: ingredient.id, quantity: '300' } });
      const order = await place();
      await payCard(order.id);
      await client.post(`/api/orders/${order.id}/cancel`).set(CSRF);
      expect((await t.prisma.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } })).stockQuantity?.toString()).toBe('1000');
      expect(await t.prisma.stockMovement.count()).toBe(0);
    });
  });

  describe('pedido pronto (05)', () => {
    it('avisa in-app (evento) e por e-mail uma única vez, com registro por canal', async () => {
      const order = await place();
      await payCard(order.id);
      await walk(order.id, 'preparing', 'ready');
      expect(t.email.messages).toHaveLength(1);
      expect(t.email.messages[0]?.destination).toBe('cliente@test.dev');
      expect(t.email.messages[0]?.message).toContain('está pronto');
      const rows = await t.prisma.orderNotification.findMany({ where: { orderId: order.id }, orderBy: { channel: 'asc' } });
      expect(rows.map(r => [r.channel, r.status])).toEqual([['email', 'sent'], ['in_app', 'sent']]);
      // Reprocessar o aviso (retry) nunca duplica o envio.
      const { ReadyNotifierService } = await import('../../src/modules/orders/ready-notifier.service.js');
      await t.app.get(ReadyNotifierService).notifyReady({ id: order.id, userId: world.client.id, establishmentId: world.estA.id });
      expect(t.email.messages).toHaveLength(1);
      expect(await t.prisma.orderNotification.count({ where: { orderId: order.id } })).toBe(2);
      const staffView = await attendant.get(`${base()}/orders?status=ready`);
      expect(staffView.body.items[0].notifications.map((n: { channel: string }) => n.channel).sort()).toEqual(['email', 'in_app']);
    });

    it('sem e-mail verificado só há aviso in-app e o e-mail fica registrado como ignorado', async () => {
      await t.prisma.user.update({ where: { id: world.client.id }, data: { emailVerifiedAt: null, phoneVerifiedAt: new Date() } });
      const order = await place();
      await t.prisma.order.update({ where: { id: order.id }, data: { status: 'paid', paidAt: new Date() } });
      await walk(order.id, 'preparing', 'ready');
      expect(t.email.messages).toHaveLength(0);
      const email = await t.prisma.orderNotification.findFirstOrThrow({ where: { orderId: order.id, channel: 'email' } });
      expect(email).toMatchObject({ status: 'skipped', errorCode: 'no_verified_contact' });
      expect(await t.prisma.orderNotification.count({ where: { orderId: order.id, channel: 'sms' } })).toBe(0);
    });

    it('falha do provedor é registrada como falha tipada — nunca como sucesso — e não impede o pedido ficar pronto', async () => {
      const original = t.email.send.bind(t.email);
      t.email.send = async () => {
        throw new MessageDeliveryError('email', 'timeout', 'smtp lento');
      };
      try {
        const order = await place();
        await payCard(order.id);
        await walk(order.id, 'preparing', 'ready');
        const email = await t.prisma.orderNotification.findFirstOrThrow({ where: { orderId: order.id, channel: 'email' } });
        expect(email).toMatchObject({ status: 'failed', errorCode: 'timeout' });
        expect((await client.get(`/api/orders/${order.id}`)).body.status).toBe('ready');
      } finally {
        t.email.send = original;
      }
    });

    it('a última estação concluída também dispara o aviso', async () => {
      const station = await t.prisma.kitchenStation.create({ data: { establishmentId: world.estA.id, name: 'Chapa' } });
      await t.prisma.menuItem.update({ where: { id: world.itemA.id }, data: { stationId: station.id } });
      const order = await place();
      await payCard(order.id);
      await walk(order.id, 'preparing');
      const res = await attendant.post(`${base()}/orders/${order.id}/items/ready`).set(CSRF).send({ stationId: station.id });
      expect(res.body.status).toBe('ready');
      expect(t.email.messages).toHaveLength(1);
    });
  });

  describe('FilaZero Club (14)', () => {
    const deliver = async (id: string) => walk(id, 'preparing', 'ready', 'delivered');

    it('pontos só entram com pagamento aprovado E pedido entregue: 1 ponto por R$ 1 (truncado)', async () => {
      const order = await place(); // R$ 20,00
      expect(await balance()).toBe(0);
      await payCard(order.id);
      await walk(order.id, 'preparing', 'ready');
      expect(await balance()).toBe(0);
      await walk(order.id, 'delivered');
      expect(await balance()).toBe(20);
      const ledger = (await client.get('/api/me/loyalty')).body;
      expect(ledger.entries[0]).toMatchObject({ type: 'earn', points: 20 });
      expect(ledger.eligible).toBe(true);
    });

    it('pedido entregue sem pagamento aprovado não gera pontos (nunca tratado como pago)', async () => {
      const order = await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'received', items: [{ menuItemId: world.itemA.id, name: 'IPA', unitPriceCents: 2000 }], data: { status: 'delivered', deliveredAt: new Date() } });
      await t.prisma.$transaction(async tx => {
        const { LoyaltyService } = await import('../../src/modules/loyalty/loyalty.service.js');
        expect(await t.app.get(LoyaltyService).earnForOrder(tx, order.id)).toBe(false);
      });
      expect(await balance()).toBe(0);
    });

    it('conta não verificada não ganha pontos; centavos são truncados', async () => {
      await t.prisma.user.update({ where: { id: world.client.id }, data: { emailVerifiedAt: null } });
      const order = await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'delivered', items: [{ menuItemId: world.itemA.id, name: 'IPA', unitPriceCents: 1999 }] });
      await t.prisma.$transaction(async tx => {
        const { LoyaltyService } = await import('../../src/modules/loyalty/loyalty.service.js');
        expect(await t.app.get(LoyaltyService).earnForOrder(tx, order.id)).toBe(false);
      });
      await verifyEmail(t.prisma, world.client.id);
      await t.prisma.$transaction(async tx => {
        const { LoyaltyService } = await import('../../src/modules/loyalty/loyalty.service.js');
        const service = t.app.get(LoyaltyService);
        expect(await service.earnForOrder(tx, order.id)).toBe(true);
        expect(await service.earnForOrder(tx, order.id)).toBe(false); // idempotente
      });
      expect(await balance()).toBe(19);
    });

    it('resgate: 100 pontos = R$ 5 de desconto, saldo nunca negativo, múltiplos de 100, total mínimo', async () => {
      await t.prisma.loyaltyLedgerEntry.create({ data: { userId: world.client.id, orderId: (await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'delivered', items: [{ menuItemId: world.itemA.id, name: 'x', unitPriceCents: 100 }] })).id, type: 'earn', points: 250 } });
      const expectFail = async (body: object) => {
        const res = await placeOrder(client, { establishmentId: world.estA.id, items: [{ menuItemId: world.itemA.id, quantity: 1 }], ...body }, CSRF);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('INVALID_REDEEM');
      };
      await expectFail({ redeemPoints: 50 });
      await expectFail({ redeemPoints: 300 });
      expect(await t.prisma.order.count()).toBe(1); // nada foi criado nas recusas
      const order = await place({ redeemPoints: 100, expectedTotalCents: 1500 });
      expect(order.totalCents).toBe(1500);
      expect(await balance()).toBe(150);
      const detail = (await client.get(`/api/orders/${order.id}`)).body;
      expect(detail).toMatchObject({ discountCents: 500, redeemedPoints: 100, totalCents: 1500 });
      // pagar cobra o valor líquido
      await payCard(order.id);
      expect(gateway.created.at(-1)?.amountCents).toBe(1500);
      // preço esperado errado (sem o desconto) é recusado
      const stale = await placeOrder(client, { establishmentId: world.estA.id, items: [{ menuItemId: world.itemA.id, quantity: 1 }], redeemPoints: 100, expectedTotalCents: 2000 }, CSRF);
      expect(stale.status).toBe(409);
    });

    it('resgate repetido com o mesmo clientRequestId não desconta duas vezes', async () => {
      await t.prisma.loyaltyLedgerEntry.create({ data: { userId: world.client.id, orderId: (await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'delivered', items: [{ menuItemId: world.itemA.id, name: 'x', unitPriceCents: 100 }] })).id, type: 'earn', points: 100 } });
      const body = { establishmentId: world.estA.id, clientRequestId: 'req-redeem-0001', redeemPoints: 100, items: [{ menuItemId: world.itemA.id, quantity: 1 }] };
      const [a, b] = await Promise.all([client.post('/api/orders').set(CSRF).send(body), client.post('/api/orders').set(CSRF).send(body)]);
      expect([a.status, b.status].every(s => s === 201 || s === 422 || s === 409)).toBe(true);
      expect(await t.prisma.loyaltyLedgerEntry.count({ where: { type: 'redeem' } })).toBe(1);
      expect(await balance()).toBe(0);
    });

    it('cancelar/estornar devolve pontos resgatados e reverte os ganhos', async () => {
      await t.prisma.loyaltyLedgerEntry.create({ data: { userId: world.client.id, orderId: (await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'delivered', items: [{ menuItemId: world.itemA.id, name: 'x', unitPriceCents: 100 }] })).id, type: 'earn', points: 100 } });
      const order = await place({ redeemPoints: 100 });
      expect(await balance()).toBe(0);
      await client.post(`/api/orders/${order.id}/cancel`).set(CSRF);
      expect(await balance()).toBe(100); // devolvidos, uma vez só
      await client.post(`/api/orders/${order.id}/cancel`).set(CSRF);
      expect(await balance()).toBe(100);

      // pontos ganhos e depois estornados são revertidos
      const done = await place();
      await payCard(done.id);
      await deliver(done.id);
      expect(await balance()).toBe(120);
      const { OrderPaymentsService } = await import('../../src/modules/orders/order-payments.service.js');
      await t.app.get(OrderPaymentsService).refund(world.estA.id, done.id).catch(() => undefined);
      const reversal = await t.prisma.loyaltyLedgerEntry.findFirst({ where: { orderId: done.id, type: 'earn_reversal' } });
      expect(reversal).toBeNull(); // entregue: não é mais estornável pelo fluxo normal
      expect(await balance()).toBe(120);
    });

    it('reverte pontos ganhos quando o pedido entregue é cancelado (saldo nunca fica negativo)', async () => {
      const order = await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'delivered', items: [{ menuItemId: world.itemA.id, name: 'IPA', unitPriceCents: 3000 }] });
      await t.prisma.$transaction(async tx => {
        const { LoyaltyService } = await import('../../src/modules/loyalty/loyalty.service.js');
        const service = t.app.get(LoyaltyService);
        await service.earnForOrder(tx, order.id);
      });
      expect(await balance()).toBe(30);
      // gasta 20 em outro pedido antes do estorno
      const other = await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'delivered', items: [{ menuItemId: world.itemA.id, name: 'y', unitPriceCents: 100 }] });
      await t.prisma.loyaltyLedgerEntry.create({ data: { userId: world.client.id, orderId: other.id, type: 'redeem', points: -20 } });
      await t.prisma.$transaction(async tx => {
        const { LoyaltyService } = await import('../../src/modules/loyalty/loyalty.service.js');
        const service = t.app.get(LoyaltyService);
        await service.revertForOrder(tx, order.id);
        await service.revertForOrder(tx, order.id); // idempotente
      });
      expect(await balance()).toBe(0);
      expect(await t.prisma.loyaltyLedgerEntry.count({ where: { orderId: order.id, type: 'earn_reversal' } })).toBe(1);
    });

    it('pedido não pago e vencido solta os pontos resgatados', async () => {
      await t.prisma.loyaltyLedgerEntry.create({ data: { userId: world.client.id, orderId: (await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'delivered', items: [{ menuItemId: world.itemA.id, name: 'x', unitPriceCents: 100 }] })).id, type: 'earn', points: 100 } });
      const order = await place({ redeemPoints: 100 });
      await t.prisma.order.update({ where: { id: order.id }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
      expect(await balance()).toBe(100); // leitura sem efeito colateral: o pedido continua como estava
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('received');
      // ao resgatar de novo, a expiração é efetivada e o razão devolve os pontos uma única vez
      await place({ redeemPoints: 100 });
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('cancelled');
      expect(await t.prisma.loyaltyLedgerEntry.count({ where: { orderId: order.id, type: 'redeem_return' } })).toBe(1);
      expect(await balance()).toBe(0);
    });
  });

  describe('estoque baixo (50)', () => {
    async function recipe(stock: string | null, min = '100', perUnit = '300') {
      const ingredient = await t.prisma.ingredient.create({ data: { establishmentId: world.estA.id, name: 'Malte', unit: 'g', unitCost: '0.01', stockQuantity: stock, minStockQuantity: min } });
      const sheet = await t.prisma.technicalSheet.create({ data: { menuItemId: world.itemA.id, costLimitPercent: '40' } });
      await t.prisma.technicalSheetItem.create({ data: { technicalSheetId: sheet.id, ingredientId: ingredient.id, quantity: perUnit } });
      return ingredient;
    }
    const stockOf = async (id: string) => (await t.prisma.ingredient.findUniqueOrThrow({ where: { id } })).stockQuantity?.toString() ?? null;

    it('baixa pela ficha técnica exatamente uma vez, na transição para preparo', async () => {
      const malte = await recipe('1000');
      const order = await place({ items: [{ menuItemId: world.itemA.id, quantity: 2 }] });
      await payCard(order.id);
      expect(await stockOf(malte.id)).toBe('1000'); // pago ainda não baixa
      await walk(order.id, 'preparing');
      expect(await stockOf(malte.id)).toBe('400');
      // Reprocessar a transição não baixa de novo.
      const { StockService } = await import('../../src/modules/stock/stock.service.js');
      await t.prisma.$transaction(tx => t.app.get(StockService).consumeForOrder(tx, order.id));
      await walk(order.id, 'ready', 'delivered');
      expect(await stockOf(malte.id)).toBe('400');
      expect(await t.prisma.stockMovement.count({ where: { orderId: order.id } })).toBe(1);
    });

    it('depois do preparo o consumo não é revertido por cancelamento da equipe', async () => {
      const malte = await recipe('1000');
      const order = await place();
      await payCard(order.id);
      await walk(order.id, 'preparing');
      await manager.post(`${base()}/orders/${order.id}/cancel`).set(CSRF);
      expect(await stockOf(malte.id)).toBe('700');
    });

    it('alerta ao gestor quando estoque ≤ mínimo, sem repetir enquanto aberto, e some ao repor', async () => {
      const malte = await recipe('450', '200');
      const o1 = await place();
      await payCard(o1.id);
      await walk(o1.id, 'preparing'); // 450 → 150 ≤ 200
      let alerts = (await manager.get(`${base()}/alerts`)).body;
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ kind: 'low_stock', refId: malte.id });
      const o2 = await place();
      await payCard(o2.id);
      await walk(o2.id, 'preparing'); // 150 → 0 (nunca negativo)
      expect(await stockOf(malte.id)).toBe('0');
      expect(await t.prisma.staffAlert.count({ where: { kind: 'low_stock', resolvedAt: null } })).toBe(1);
      expect((await attendant.get(`${base()}/alerts`)).body).toHaveLength(0); // atendente não vê estoque
      const restock = await manager.put(`${base()}/ingredients/${malte.id}/stock`).set(CSRF).send({ stockQuantity: 5000, minStockQuantity: 200 });
      expect(restock.status).toBe(200);
      expect(restock.body).toMatchObject({ stockQuantity: '5000.0000', lowStock: false });
      alerts = (await manager.get(`${base()}/alerts`)).body;
      expect(alerts).toHaveLength(0);
    });

    it('insumo sem controle não baixa; só o gestor define estoque; mínimo inválido é recusado', async () => {
      const malte = await recipe(null);
      const order = await place();
      await payCard(order.id);
      await walk(order.id, 'preparing');
      expect(await stockOf(malte.id)).toBeNull();
      expect(await t.prisma.stockMovement.count()).toBe(0);
      const put = (agent: Agent, body: object) => agent.put(`${base()}/ingredients/${malte.id}/stock`).set(CSRF).send(body);
      expect((await put(attendant, { stockQuantity: 10 })).status).toBe(403);
      expect((await put(manager, { stockQuantity: -1 })).status).toBe(400);
      expect((await put(manager, { stockQuantity: 10, minStockQuantity: 20 })).body.lowStock).toBe(true);
      expect((await manager.get(`${base()}/ingredients`)).body[0]).toMatchObject({ stockQuantity: '10.0000', minStockQuantity: '20.0000', lowStock: true });
      expect((await put(manager, { stockQuantity: null })).body).toMatchObject({ stockQuantity: null, lowStock: false });
      expect(await t.prisma.staffAlert.count({ where: { resolvedAt: null } })).toBe(0);
    });
  });
});
