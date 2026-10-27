import { resetDatabase } from '../helpers/database.js';
import { FakePaymentGateway } from '../helpers/fake-gateway.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, seedOrder, verifyEmail } from '../helpers/orders.js';
import { GatewayError } from '../../src/modules/payments/payment-gateway.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

describe('Sprint 3 — reauditoria do QA (R1–R5)', () => {
  let t: TestApp;
  let gateway: FakePaymentGateway;
  let world: World;
  let tableId: string;
  let client: Agent;
  let attendant: Agent;
  const base = () => `/api/establishments/${world.estA.id}`;
  const card = { method: 'credit', cardToken: 'tok_test_123456', paymentMethodId: 'visa' };
  let seq = 0;
  const key = () => `r-key-${++seq}-abcdefgh`;

  beforeAll(async () => {
    gateway = new FakePaymentGateway();
    t = await createTestApp(undefined, gateway);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    tableId = (await createOrdersWorld(t.prisma, world)).tableA.id;
    await verifyEmail(t.prisma, world.client.id);
    client = await login(t.browser(), world.client.email);
    attendant = await login(t.browser(), world.attendantA.email);
    gateway.reset();
    seq = 0;
  });
  afterEach(() => {
    delete (gateway as { createPayment?: unknown }).createPayment;
    delete (gateway as { refundPayment?: unknown }).refundPayment;
  });

  const tabOrder = async (price = 2000) => {
    const tab = (await attendant.post(`${base()}/tables/${tableId}/tab`).set(CSRF)).body as { id: string };
    const order = await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'received', tableId, items: [{ menuItemId: world.itemA.id, name: 'IPA', unitPriceCents: price }] });
    expect((await attendant.post(`${base()}/tabs/${tab.id}/orders`).set(CSRF).send({ orderId: order.id })).status).toBe(200);
    return { tab, order };
  };
  const close = (tabId: string, body: object = {}) => attendant.post(`${base()}/tabs/${tabId}/close`).set(CSRF).send({ idempotencyKey: key(), ...card, ...body });
  const failRefunds = () => {
    gateway.refundPayment = async () => {
      throw new GatewayError('indisponível', 503, 'unknown');
    };
  };

  it('R1 — com estorno pendente, outra chave NÃO cobra a comanda de novo', async () => {
    const { tab, order } = await tabOrder();
    const original = gateway.createPayment.bind(gateway);
    gateway.createPayment = async input => {
      const result = await original(input);
      await t.prisma.order.update({ where: { id: order.id }, data: { status: 'cancelled', cancelledAt: new Date() } });
      return result;
    };
    failRefunds();
    expect((await close(tab.id)).body.code).toBe('TAB_REFUND_PENDING');
    delete (gateway as { createPayment?: unknown }).createPayment;
    const second = await close(tab.id);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('TAB_REFUND_PENDING');
    expect(gateway.charges).toBe(1);
    expect(await t.prisma.tabPayment.count()).toBe(1);
    delete (gateway as { refundPayment?: unknown }).refundPayment;
    expect((await attendant.post(`${base()}/tabs/${tab.id}/refunds/retry`).set(CSRF)).body).toEqual({ retried: 1, stillPending: 0 });
    expect((await close(tab.id)).status).toBe(200); // estorno concluído: a comanda pode fechar (saldo zero)
  });

  describe('R2 — Pix individual aprovado tarde depois da comanda quitada', () => {
    async function lateApproval() {
      const { tab, order } = await tabOrder();
      const pix = await client.post(`/api/orders/${order.id}/payments`).set(CSRF).send({ method: 'pix' });
      expect(pix.status).toBe(201);
      const pixId = gateway.lastId;
      await t.prisma.payment.updateMany({ data: { pixExpiresAt: new Date(Date.now() - 60_000) } }); // vencido só localmente
      expect((await close(tab.id)).status).toBe(200);
      gateway.set(pixId, { status: 'approved' }); // o gateway aprova depois do prazo local
      return { tab, order, pixId };
    }

    it('estorna o Pix duplicado automaticamente e não move o pedido para pago nem o cancela', async () => {
      const { order, pixId } = await lateApproval();
      const synced = await client.post(`/api/orders/${order.id}/payments/sync`).set(CSRF);
      expect(synced.status).toBe(200);
      expect(gateway.refunded).toEqual([pixId]);
      const row = await t.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { payments: true } });
      expect(row.status).toBe('received'); // não virou pago e não foi cancelado
      expect(row.tabSettledAt).not.toBeNull();
      expect(row.payments[0]).toMatchObject({ status: 'refunded' });
      expect(await t.prisma.staffAlert.count()).toBe(0);
    });

    it('sem confirmação do estorno: alerta não dispensável com tabId e repetição conclui', async () => {
      const { tab, order } = await lateApproval();
      failRefunds();
      await client.post(`/api/orders/${order.id}/payments/sync`).set(CSRF);
      const row = await t.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      expect(row).toMatchObject({ status: 'approved' });
      expect(row.refundRequestedAt).not.toBeNull();
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('received');
      const alerts = (await attendant.get(`${base()}/alerts`)).body as { id: string; kind: string; tabId: string | null }[];
      expect(alerts).toEqual([expect.objectContaining({ kind: 'tab_refund_pending', refId: row.id, tabId: tab.id })]);
      expect((await attendant.post(`${base()}/alerts/${alerts[0]?.id}/dismiss`).set(CSRF)).body.code).toBe('ALERT_NOT_DISMISSIBLE');
      expect((await attendant.post(`${base()}/tabs/${tab.id}/refunds/retry`).set(CSRF)).body).toEqual({ retried: 0, stillPending: 1 });
      delete (gateway as { refundPayment?: unknown }).refundPayment;
      expect((await attendant.post(`${base()}/tabs/${tab.id}/refunds/retry`).set(CSRF)).body).toEqual({ retried: 1, stillPending: 0 });
      expect((await t.prisma.payment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('refunded');
      expect((await attendant.get(`${base()}/alerts`)).body).toHaveLength(0);
    });
  });

  it('R3 — estorno pendente nunca é apagado por dispensa (alerta continua e o retry resolve)', async () => {
    const { tab, order } = await tabOrder();
    const original = gateway.createPayment.bind(gateway);
    gateway.createPayment = async input => {
      const result = await original(input);
      await t.prisma.order.update({ where: { id: order.id }, data: { status: 'cancelled', cancelledAt: new Date() } });
      return result;
    };
    failRefunds();
    await close(tab.id);
    const [alert] = (await attendant.get(`${base()}/alerts`)).body as { id: string }[];
    expect((await attendant.post(`${base()}/alerts/${alert?.id}/dismiss`).set(CSRF)).status).toBe(409);
    expect((await attendant.get(`${base()}/alerts`)).body).toHaveLength(1);
  });

  describe('R4 — cartão individual pendente sem resposta não trava o caixa', () => {
    const stalePending = async (orderId: string) => t.prisma.payment.create({ data: { orderId, attempt: 1, method: 'credit', status: 'pending', amountCents: 2000, createdAt: new Date(Date.now() - 31 * 60_000) } });

    it('gateway confirma que não há cobrança: a tentativa é encerrada e o fechamento segue', async () => {
      const { tab, order } = await tabOrder();
      const stale = await stalePending(order.id);
      expect((await close(tab.id)).status).toBe(200);
      expect(await t.prisma.payment.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({ status: 'cancelled', failureReason: 'unconfirmed' });
    });

    it('gateway fora do ar: continua bloqueado (nunca cobra no escuro)', async () => {
      const { tab, order } = await tabOrder();
      await stalePending(order.id);
      gateway.searchFails = true;
      const res = await close(tab.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ORDER_HAS_PENDING_PAYMENT');
      expect(gateway.charges).toBe(0);
    });
  });

  describe('R5 — refunds/retry: acesso e escopo', () => {
    it('só quem tem tabs.manage na casa da comanda; comanda de outra casa responde 404', async () => {
      const { tab } = await tabOrder();
      const url = (est: string) => `/api/establishments/${est}/tabs/${tab.id}/refunds/retry`;
      expect((await client.post(url(world.estA.id)).set(CSRF)).status).toBe(403);
      await t.prisma.userPermission.deleteMany({ where: { userId: world.attendantA.id, permission: 'tabs.manage' } });
      const noPermission = await login(t.browser(), world.attendantA.email);
      expect((await noPermission.post(url(world.estA.id)).set(CSRF)).status).toBe(403);
      const managerB = await login(t.browser(), world.managerB.email);
      expect((await managerB.post(url(world.estA.id)).set(CSRF)).status).toBe(403);
      expect((await managerB.post(url(world.estB.id)).set(CSRF)).status).toBe(404);
      const managerA = await login(t.browser(), world.managerA.email);
      expect((await managerA.post(url(world.estA.id)).set(CSRF)).body).toEqual({ retried: 0, stillPending: 0 });
    });
  });
});
