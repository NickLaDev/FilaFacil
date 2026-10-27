import { resetDatabase } from '../helpers/database.js';
import { FakePaymentGateway } from '../helpers/fake-gateway.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, seedOrder } from '../helpers/orders.js';
import { GatewayError } from '../../src/modules/payments/payment-gateway.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

describe('Sprint 3 — tentativas antigas de fechamento de comanda (resolveStale e aprovação tardia)', () => {
  let t: TestApp;
  let gateway: FakePaymentGateway;
  let world: World;
  let tableId: string;
  let attendant: Agent;
  const base = () => `/api/establishments/${world.estA.id}`;
  const card = { method: 'credit', cardToken: 'tok_test_123456', paymentMethodId: 'visa' };
  let seq = 0;
  const close = (tabId: string) => attendant.post(`${base()}/tabs/${tabId}/close`).set(CSRF).send({ idempotencyKey: `stale-key-${++seq}-abcdefgh`, ...card });
  const old = () => new Date(Date.now() - 31 * 60_000);

  beforeAll(async () => {
    gateway = new FakePaymentGateway();
    t = await createTestApp(undefined, gateway);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    tableId = (await createOrdersWorld(t.prisma, world)).tableA.id;
    attendant = await login(t.browser(), world.attendantA.email);
    gateway.reset();
    seq = 0;
  });
  afterEach(() => {
    delete (gateway as { findByReference?: unknown }).findByReference;
    delete (gateway as { refundPayment?: unknown }).refundPayment;
  });

  const openTab = async (price = 2000) => {
    const tab = (await attendant.post(`${base()}/tables/${tableId}/tab`).set(CSRF)).body as { id: string };
    const order = await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'received', tableId, items: [{ menuItemId: world.itemA.id, name: 'IPA', unitPriceCents: price }] });
    await attendant.post(`${base()}/tabs/${tab.id}/orders`).set(CSRF).send({ orderId: order.id });
    return { tab, order };
  };
  const attempt = (tabId: string, status: 'pending' | 'expired', extra: object = {}) =>
    t.prisma.tabPayment.create({ data: { tabId, idempotencyKey: `seed-${++seq}-abcdefgh`, method: 'credit', amountCents: 2000, status, createdAt: old(), ...extra } });
  /** Cobrança que o gateway tem para a tentativa (como se tivesse cobrado e a resposta se perdeu). */
  const chargedAtGateway = (paymentId: string) =>
    gateway.createPayment({ reference: paymentId, idempotencyKey: `tab-payment-${paymentId}`, amountCents: 2000, description: 'x', method: 'credit', payerEmail: 'a@b.c', expiresAt: new Date(), cardToken: 'tok_test_123456', paymentMethodId: 'visa' });

  describe('resolveStale', () => {
    it('GatewayError (gateway fora do ar) mantém a tentativa pendente e bloqueia sem cobrar', async () => {
      const { tab } = await openTab();
      const stale = await attempt(tab.id, 'pending');
      gateway.searchFails = true;
      const res = await close(tab.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TAB_PAYMENT_IN_PROGRESS');
      expect((await t.prisma.tabPayment.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('pending');
      expect(gateway.charges).toBe(0);
    });

    it('erro inesperado NÃO é engolido: propaga (500) e a tentativa continua pendente', async () => {
      const { tab } = await openTab();
      const stale = await attempt(tab.id, 'pending');
      gateway.findByReference = async () => {
        throw new TypeError('bug local');
      };
      expect((await close(tab.id)).status).toBe(500);
      expect((await t.prisma.tabPayment.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('pending');
      expect(gateway.charges).toBe(0);
    });

    it('findByReference vazio expira com failureReason unconfirmed e o novo fechamento cobra uma vez', async () => {
      const { tab } = await openTab();
      const stale = await attempt(tab.id, 'pending');
      expect((await close(tab.id)).status).toBe(200);
      expect(await t.prisma.tabPayment.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({ status: 'expired', failureReason: 'unconfirmed' });
      expect(gateway.charges).toBe(1);
    });

    it('cobrança encontrada no gateway é aplicada (comanda fecha) e nada é cobrado de novo', async () => {
      const { tab, order } = await openTab();
      const stale = await attempt(tab.id, 'pending');
      await chargedAtGateway(stale.id);
      const res = await close(tab.id);
      expect(res.status).toBe(409); // a comanda já foi fechada pela tentativa antiga
      expect(res.body.code).toBe('TAB_CLOSED');
      expect(await t.prisma.tabPayment.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({ status: 'approved' });
      expect((await t.prisma.tab.findUniqueOrThrow({ where: { id: tab.id } })).status).toBe('closed');
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).tabSettledAt).not.toBeNull();
      expect(gateway.charges).toBe(1);
    });
  });

  describe('aprovação tardia de tentativa já expirada', () => {
    it('comanda ainda aberta e valor igual: a cobrança é aproveitada (tentativa revive, comanda fecha, sem cobrar de novo)', async () => {
      const { tab } = await openTab();
      const expired = await attempt(tab.id, 'expired', { failureReason: 'unconfirmed' });
      await chargedAtGateway(expired.id); // o gateway aprovou depois que expiramos
      const res = await close(tab.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TAB_CLOSED');
      expect(await t.prisma.tabPayment.findUniqueOrThrow({ where: { id: expired.id } })).toMatchObject({ status: 'approved' });
      expect(gateway.charges).toBe(1);
      expect(gateway.refunded).toHaveLength(0);
    });

    it('comanda já fechada por outro pagamento: a cobrança tardia é estornada', async () => {
      const { tab } = await openTab();
      expect((await close(tab.id)).status).toBe(200); // fecha normalmente (1 cobrança)
      const expired = await attempt(tab.id, 'expired', { failureReason: 'unconfirmed' });
      const late = await chargedAtGateway(expired.id);
      const res = await close(tab.id);
      expect(res.status).toBe(409);
      expect(gateway.refunded).toEqual([late.id]);
      expect(await t.prisma.tabPayment.findUniqueOrThrow({ where: { id: expired.id } })).toMatchObject({ status: 'cancelled', failureReason: 'late_refunded' });
    });

    it('estorno tardio sem confirmação: pendente, alerta com a comanda e retry conclui', async () => {
      const { tab } = await openTab();
      await close(tab.id);
      const expired = await attempt(tab.id, 'expired', { failureReason: 'unconfirmed' });
      await chargedAtGateway(expired.id);
      gateway.refundPayment = async () => {
        throw new GatewayError('indisponível', 503, 'unknown');
      };
      await close(tab.id);
      expect(await t.prisma.tabPayment.findUniqueOrThrow({ where: { id: expired.id } })).toMatchObject({ status: 'cancelled', failureReason: 'refund_pending' });
      const alerts = (await attendant.get(`${base()}/alerts`)).body as { kind: string; tabId: string }[];
      expect(alerts).toEqual([expect.objectContaining({ kind: 'tab_refund_pending', tabId: tab.id })]);
      delete (gateway as { refundPayment?: unknown }).refundPayment;
      expect((await attendant.post(`${base()}/tabs/${tab.id}/refunds/retry`).set(CSRF)).body).toEqual({ retried: 1, stillPending: 0 });
      expect((await attendant.get(`${base()}/alerts`)).body).toHaveLength(0);
    });

    it('gateway sem a cobrança (ou não aprovada) deixa a tentativa expirada como está', async () => {
      const { tab } = await openTab();
      const expired = await attempt(tab.id, 'expired', { failureReason: 'unconfirmed' });
      expect((await close(tab.id)).status).toBe(200);
      expect((await t.prisma.tabPayment.findUniqueOrThrow({ where: { id: expired.id } })).status).toBe('expired');
      expect(gateway.refunded).toHaveLength(0);
    });
  });
});
