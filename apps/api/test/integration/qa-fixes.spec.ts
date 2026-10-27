import { AppConfig } from '../../src/config/app-config.js';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service.js';
import { MessageDeliveryError } from '../../src/modules/notifications/delivery-error.js';
import { GatewayError } from '../../src/modules/payments/payment-gateway.js';
import { resetDatabase } from '../helpers/database.js';
import { FakePaymentGateway } from '../helpers/fake-gateway.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, seedOrder, verifyEmail } from '../helpers/orders.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

describe('Sprint 3 — correções do QA (comanda × pagamento × cancelamento, falhas de provedor)', () => {
  let t: TestApp;
  let gateway: FakePaymentGateway;
  let world: World;
  let tableId: string;
  let client: Agent;
  let attendant: Agent;
  let manager: Agent;
  const base = () => `/api/establishments/${world.estA.id}`;
  const card = { method: 'credit', cardToken: 'tok_test_123456', paymentMethodId: 'visa' };
  let seq = 0;
  const key = () => `qa-key-${++seq}-abcdefgh`;

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
    manager = await login(t.browser(), world.managerA.email);
    gateway.reset();
    t.sms.messages.length = 0;
    seq = 0;
  });

  const tabOrder = async (price = 2000) => {
    const tab = (await attendant.post(`${base()}/tables/${tableId}/tab`).set(CSRF)).body as { id: string };
    const order = await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'received', tableId, items: [{ menuItemId: world.itemA.id, name: 'IPA', unitPriceCents: price }] });
    expect((await attendant.post(`${base()}/tabs/${tab.id}/orders`).set(CSRF).send({ orderId: order.id })).status).toBe(200);
    return { tab, order };
  };
  const close = (tabId: string, body: object = {}) => attendant.post(`${base()}/tabs/${tabId}/close`).set(CSRF).send({ idempotencyKey: key(), ...card, ...body });
  const pay = (orderId: string, body: object = card) => client.post(`/api/orders/${orderId}/payments`).set(CSRF).send(body);

  describe('A1 — pedido quitado na comanda não é pago de novo', () => {
    it('cartão e Pix recusados com ALREADY_PAID; o pedido deixa de ser cancelável pelo app', async () => {
      const { tab, order } = await tabOrder();
      expect((await close(tab.id)).status).toBe(200);
      const charges = gateway.created.length;
      const card1 = await pay(order.id);
      expect(card1.status).toBe(409);
      expect(card1.body.code).toBe('ALREADY_PAID');
      expect((await pay(order.id, { method: 'pix' })).body.code).toBe('ALREADY_PAID');
      expect(gateway.created).toHaveLength(charges);
      expect((await client.get(`/api/orders/${order.id}`)).body.cancellable).toBe(false);
      expect(await t.prisma.payment.count()).toBe(0);
    });
  });

  describe('A2 — Pix pendente × fechamento da comanda', () => {
    it('o fechamento espera o pagamento individual em andamento e nunca cobra duas vezes', async () => {
      const { tab, order } = await tabOrder();
      const pix = await pay(order.id, { method: 'pix' });
      expect(pix.status).toBe(201);
      const blocked = await close(tab.id);
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('ORDER_HAS_PENDING_PAYMENT');
      expect(gateway.created.filter(c => c.method === 'credit')).toHaveLength(0);
      expect(await t.prisma.tabPayment.count()).toBe(0);
      // Pix já vencido não pode mais ser pago: deixa de bloquear.
      await t.prisma.payment.updateMany({ data: { pixExpiresAt: new Date(Date.now() - 60_000) } });
      expect((await close(tab.id)).status).toBe(200);
    });

    it('com o fechamento em andamento o pagamento individual espera; corrida paga uma única vez', async () => {
      const { tab, order } = await tabOrder();
      await t.prisma.tabPayment.create({ data: { tabId: tab.id, idempotencyKey: 'in-flight-1', method: 'credit', amountCents: 2000 } });
      const during = await pay(order.id);
      expect(during.status).toBe(409);
      expect(during.body.code).toBe('TAB_PAYMENT_IN_PROGRESS');
      await t.prisma.tabPayment.deleteMany();

      const [paid, closed] = await Promise.all([pay(order.id), close(tab.id)]);
      expect([paid.status, closed.status].filter(status => status === 200 || status === 201).length).toBeGreaterThanOrEqual(1);
      expect(gateway.charges).toBe(1); // R$ 20 cobrado uma única vez, por um dos dois caminhos
    });
  });

  describe('A3 — cancelar pedido quitado na comanda', () => {
    it('é recusado com código tipado para o cliente e para a equipe (nada fica cobrado sem estorno)', async () => {
      const { tab, order } = await tabOrder();
      expect((await close(tab.id)).status).toBe(200);
      const byClient = await client.post(`/api/orders/${order.id}/cancel`).set(CSRF);
      expect(byClient.status).toBe(409);
      expect(byClient.body.code).toBe('ORDER_SETTLED_ON_TAB');
      const byManager = await manager.post(`${base()}/orders/${order.id}/cancel`).set(CSRF);
      expect(byManager.status).toBe(409);
      expect(byManager.body.code).toBe('ORDER_SETTLED_ON_TAB');
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('received');
    });
  });

  describe('M1 — saldo muda durante a cobrança', () => {
    /** Depois que o gateway cobra, o pedido é cancelado por fora: o saldo deixa de bater. */
    function changeBalanceAfterCharge(orderId: string) {
      const original = gateway.createPayment.bind(gateway);
      gateway.createPayment = async input => {
        const result = await original(input);
        await t.prisma.order.update({ where: { id: orderId }, data: { status: 'cancelled', cancelledAt: new Date() } });
        return result;
      };
    }
    afterEach(() => {
      delete (gateway as { createPayment?: unknown }).createPayment;
    });

    it('estorno bem-sucedido: 409 TAB_BALANCE_CHANGED e a comanda segue aberta', async () => {
      const { tab, order } = await tabOrder();
      changeBalanceAfterCharge(order.id);
      const res = await close(tab.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TAB_BALANCE_CHANGED');
      expect(gateway.refunded).toHaveLength(1);
      expect((await t.prisma.tab.findUniqueOrThrow({ where: { id: tab.id } })).status).toBe('open');
    });

    it('estorno falho: fica pendente e repetível, com alerta para a equipe', async () => {
      const { tab, order } = await tabOrder();
      changeBalanceAfterCharge(order.id);
      const originalRefund = gateway.refundPayment.bind(gateway);
      gateway.refundPayment = async () => {
        throw new GatewayError('indisponível', 503, 'unknown');
      };
      const res = await close(tab.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TAB_REFUND_PENDING');
      const row = await t.prisma.tabPayment.findFirstOrThrow();
      expect(row).toMatchObject({ status: 'cancelled', failureReason: 'refund_pending' });
      const alerts = (await attendant.get(`${base()}/alerts`)).body;
      expect(alerts).toEqual([expect.objectContaining({ kind: 'tab_refund_pending', refId: row.id, tabId: tab.id })]);

      // enquanto o gateway segue fora, repetir mantém pendente; depois conclui e resolve o alerta
      expect((await attendant.post(`${base()}/tabs/${tab.id}/refunds/retry`).set(CSRF)).body).toEqual({ retried: 0, stillPending: 1 });
      gateway.refundPayment = originalRefund;
      expect((await attendant.post(`${base()}/tabs/${tab.id}/refunds/retry`).set(CSRF)).body).toEqual({ retried: 1, stillPending: 0 });
      expect((await t.prisma.tabPayment.findUniqueOrThrow({ where: { id: row.id } })).failureReason).toBe('balance_changed');
      expect((await attendant.get(`${base()}/alerts`)).body).toHaveLength(0);
      expect(gateway.refunded).toHaveLength(1);
      delete (gateway as { refundPayment?: unknown }).refundPayment;
    });
  });

  describe('M2 — tentativa pendente sem resposta não trava a comanda', () => {
    it('depois de 30 min sem cobrança no gateway a tentativa expira e outro fechamento funciona', async () => {
      const { tab } = await tabOrder();
      await t.prisma.tabPayment.create({ data: { tabId: tab.id, idempotencyKey: 'lost-attempt-1', method: 'credit', amountCents: 2000, createdAt: new Date(Date.now() - 31 * 60_000) } });
      const res = await close(tab.id);
      expect(res.status).toBe(200);
      expect(await t.prisma.tabPayment.findFirstOrThrow({ where: { idempotencyKey: 'lost-attempt-1' } })).toMatchObject({ status: 'expired', failureReason: 'unconfirmed' });
      expect(gateway.charges).toBe(1);
    });

    it('com o gateway fora do ar a tentativa antiga continua pendente (nunca cobra no escuro)', async () => {
      const { tab } = await tabOrder();
      await t.prisma.tabPayment.create({ data: { tabId: tab.id, idempotencyKey: 'lost-attempt-2', method: 'credit', amountCents: 2000, createdAt: new Date(Date.now() - 31 * 60_000) } });
      gateway.searchFails = true;
      const res = await close(tab.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TAB_PAYMENT_IN_PROGRESS');
      expect(gateway.charges).toBe(0);
    });
  });

  describe('M4 — expiração de pontos × cobrança em andamento', () => {
    it('pedido vencido com pagamento pendente não é cancelado pela expiração', async () => {
      const earn = await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'delivered', items: [{ menuItemId: world.itemA.id, name: 'x', unitPriceCents: 100 }] });
      await t.prisma.loyaltyLedgerEntry.create({ data: { userId: world.client.id, orderId: earn.id, type: 'earn', points: 100 } });
      const order = (await client.post('/api/orders').set(CSRF).send({ establishmentId: world.estA.id, clientRequestId: 'redeem-expire-1', redeemPoints: 100, items: [{ menuItemId: world.itemA.id, quantity: 1 }] })).body;
      await t.prisma.order.update({ where: { id: order.id }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
      await t.prisma.payment.create({ data: { orderId: order.id, attempt: 1, method: 'pix', status: 'pending', amountCents: 1500, providerPaymentId: 'pend-1' } });
      await t.app.get(LoyaltyService).releaseExpired(world.client.id);
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('received');
      expect((await client.get('/api/me/loyalty')).body.balancePoints).toBe(0);
    });
  });

  describe('falhas de provedor', () => {
    it('OTP_DELIVERY_FAILED: 502, sem desafio guardado e sem vazar detalhes', async () => {
      const original = t.sms.send.bind(t.sms);
      t.sms.send = async () => {
        throw new MessageDeliveryError('sms', 'auth', 'credencial inválida do provedor');
      };
      try {
        const res = await t.browser().post('/api/auth/otp').set(CSRF).send({ channel: 'phone', destination: '(19) 99999-0000' });
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('OTP_DELIVERY_FAILED');
        expect(JSON.stringify(res.body)).not.toContain('credencial inválida');
        expect(await t.prisma.otpChallenge.count()).toBe(0);
      } finally {
        t.sms.send = original;
      }
    });

    describe('aviso de pronto por SMS (ORDER_READY_SMS=true)', () => {
      const env = () => t.app.get(AppConfig).env as { ORDER_READY_SMS: boolean };
      beforeEach(async () => {
        env().ORDER_READY_SMS = true;
        await t.prisma.user.update({ where: { id: world.client.id }, data: { phoneVerifiedAt: new Date() } });
      });
      afterEach(() => {
        env().ORDER_READY_SMS = false;
        t.sms.available = true;
      });
      const readyOrder = async () => {
        const order = await seedOrder(t.prisma, { userId: world.client.id, establishmentId: world.estA.id, status: 'preparing', items: [{ menuItemId: world.itemA.id, name: 'IPA', unitPriceCents: 2000 }] });
        expect((await attendant.patch(`${base()}/orders/${order.id}/status`).set(CSRF).send({ status: 'ready' })).status).toBe(200);
        return order;
      };
      const smsRow = (orderId: string) => t.prisma.orderNotification.findFirstOrThrow({ where: { orderId, channel: 'sms' } });

      it('envia uma vez para o celular verificado', async () => {
        const order = await readyOrder();
        expect(t.sms.messages).toHaveLength(1);
        expect(t.sms.messages[0]?.destination).toBe('19999990000');
        expect(await smsRow(order.id)).toMatchObject({ status: 'sent', errorCode: null });
      });

      it('falha do provedor fica como failed com código; provedor indisponível também é failed', async () => {
        const original = t.sms.send.bind(t.sms);
        t.sms.send = async () => {
          throw new MessageDeliveryError('sms', 'rejected', 'trial');
        };
        const failed = await readyOrder();
        t.sms.send = original;
        expect(await smsRow(failed.id)).toMatchObject({ status: 'failed', errorCode: 'rejected' });
        t.sms.available = false;
        const unavailable = await readyOrder();
        expect(await smsRow(unavailable.id)).toMatchObject({ status: 'failed', errorCode: 'provider_unavailable' });
      });

      it('sem celular verificado o SMS é ignorado (skipped), não falha', async () => {
        await t.prisma.user.update({ where: { id: world.client.id }, data: { phoneVerifiedAt: null } });
        const order = await readyOrder();
        expect(t.sms.messages).toHaveLength(0);
        expect(await smsRow(order.id)).toMatchObject({ status: 'skipped', errorCode: 'no_verified_contact' });
      });
    });
  });
});
