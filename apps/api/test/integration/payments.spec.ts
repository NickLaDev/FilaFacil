import { resetDatabase } from '../helpers/database.js';
import { FakePaymentGateway, VALID_SIGNATURE } from '../helpers/fake-gateway.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, placeOrder, verifyEmail } from '../helpers/orders.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

describe('Pagamento pelo aplicativo (fichas 04 e 65)', () => {
  let t: TestApp;
  let gateway: FakePaymentGateway;
  let world: World;
  let client: Agent;

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
    gateway.reset();
  });

  const newOrder = async () => (await placeOrder(client, { establishmentId: world.estA.id, items: [{ menuItemId: world.itemA.id, quantity: 1 }] }, CSRF)).body.id as string;
  const pay = (orderId: string, body: object = { method: 'pix' }) => client.post(`/api/orders/${orderId}/payments`).set(CSRF).send(body);
  const card = { method: 'credit', cardToken: 'tok_test_123456', paymentMethodId: 'visa' };
  const webhook = (dataId: string, signature = VALID_SIGNATURE, query = 'type=payment') =>
    t.browser().post(`/api/payments/webhook?${query}&data.id=${dataId}`).set('x-signature', signature).set('x-request-id', 'req-1').send({ type: 'payment', data: { id: dataId } });
  const stored = (orderId: string) => t.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: { orderBy: { attempt: 'asc' } } } });

  describe('regras de acesso', () => {
    it('conta sem e-mail ou celular verificado não paga e o gateway nem é chamado (ficha 65)', async () => {
      await t.prisma.user.update({ where: { id: world.client.id }, data: { emailVerifiedAt: null, phoneVerifiedAt: null } });
      const orderId = await newOrder();
      const response = await pay(orderId);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('CONTACT_NOT_VERIFIED');
      expect(gateway.created).toHaveLength(0);
      expect(await t.prisma.payment.count()).toBe(0);
    });

    it('celular verificado também libera o pagamento', async () => {
      await t.prisma.user.update({ where: { id: world.client.id }, data: { emailVerifiedAt: null, phoneVerifiedAt: new Date() } });
      expect((await pay(await newOrder())).status).toBe(201);
    });

    it('sem gateway configurado o pagamento é recusado (503) em vez de aprovado', async () => {
      gateway.available = false;
      const response = await pay(await newOrder());
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('PAYMENT_UNAVAILABLE');
    });

    it('pedido de outra pessoa responde 404 e cartão exige token', async () => {
      const orderId = await newOrder();
      expect((await pay(orderId, { method: 'credit' })).status).toBe(400);
      const stranger = await login(t.browser(), 'outro@test.dev');
      expect((await stranger.post(`/api/orders/${orderId}/payments`).set(CSRF).send({ method: 'pix' })).status).toBe(404);
      expect((await stranger.post(`/api/orders/${orderId}/payments/sync`).set(CSRF)).status).toBe(404);
    });
  });

  describe('Pix', () => {
    it('gera a cobrança no gateway com o valor do servidor e devolve o código copia-e-cola', async () => {
      const orderId = await newOrder();
      const response = await pay(orderId);
      expect(response.status).toBe(201);
      expect(response.body.status).toBe('received');
      expect(response.body.payment).toMatchObject({ method: 'pix', status: 'pending', amountCents: 2000, transactionId: gateway.lastId });
      expect(response.body.payment.pix.copyPaste).toBe('000201-pix-1');
      expect(gateway.created[0]).toMatchObject({ amountCents: 2000, method: 'pix', payerEmail: 'cliente@test.dev' });
    });

    it('repetir o pedido de pagamento reaproveita o Pix e nunca cobra duas vezes', async () => {
      const orderId = await newOrder();
      const results = await Promise.all([pay(orderId), pay(orderId), pay(orderId)]);
      expect(results.every(result => result.status === 201)).toBe(true);
      expect(new Set(results.map(result => result.body.payment.id)).size).toBe(1);
      expect(gateway.created).toHaveLength(1);
      expect(await t.prisma.payment.count()).toBe(1);
      // Chave e referência são o id da tentativa gravada (estáveis em qualquer repetição).
      const row = (await stored(orderId)).payments[0];
      expect(gateway.created[0]).toMatchObject({ idempotencyKey: `payment-${row?.id}`, reference: row?.id });
    });

    it('a sincronização confirma o pagamento só quando o gateway aprova (e é idempotente)', async () => {
      const orderId = await newOrder();
      await pay(orderId);
      const pending = await client.post(`/api/orders/${orderId}/payments/sync`).set(CSRF);
      expect(pending.body.status).toBe('received');

      gateway.set(gateway.lastId, { status: 'approved' });
      const first = await client.post(`/api/orders/${orderId}/payments/sync`).set(CSRF);
      expect(first.body).toMatchObject({ status: 'paid', payment: { status: 'approved' } });
      const approvedAt = (await stored(orderId)).payments[0]?.approvedAt;
      const second = await client.post(`/api/orders/${orderId}/payments/sync`).set(CSRF);
      expect(second.body.status).toBe('paid');
      expect((await stored(orderId)).payments[0]?.approvedAt).toEqual(approvedAt);

      const again = await pay(orderId);
      expect(again.status).toBe(409);
      expect(['ORDER_NOT_PAYABLE', 'ALREADY_PAID']).toContain(again.body.code);
    });

    it('Pix vencido libera um novo código (outra tentativa) e o cancelado não fica em aberto', async () => {
      const orderId = await newOrder();
      await pay(orderId);
      await t.prisma.payment.updateMany({ data: { pixExpiresAt: new Date(Date.now() - 1000) } });
      const second = await pay(orderId);
      expect(second.status).toBe(201);
      expect(gateway.cancelled).toEqual(['fake-1']);
      const payments = (await stored(orderId)).payments;
      expect(payments.map(payment => [payment.attempt, payment.status])).toEqual([[1, 'cancelled'], [2, 'pending']]);
      expect(second.body.payment.pix.copyPaste).toBe('000201-pix-2');
    });

    it('Pix que o gateway marca como expirado fica expirado e o pedido continua aguardando', async () => {
      const orderId = await newOrder();
      await pay(orderId);
      gateway.set(gateway.lastId, { status: 'expired' });
      const synced = await client.post(`/api/orders/${orderId}/payments/sync`).set(CSRF);
      expect(synced.body).toMatchObject({ status: 'received', payment: { status: 'expired' } });
      expect((await pay(orderId)).status).toBe(201);
    });
  });

  describe('cartão', () => {
    it('cartão aprovado marca o pedido como pago na hora e gera o comprovante a partir do servidor', async () => {
      const orderId = await newOrder();
      const response = await pay(orderId, card);
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        status: 'paid',
        payment: { method: 'credit', status: 'approved', amountCents: 2000, transactionId: gateway.lastId, pix: null },
      });
      expect(response.body.payment.approvedAt).toEqual(expect.any(String));
      // O token vai ao gateway; nada de cartão é gravado.
      expect(gateway.created[0]).toMatchObject({ cardToken: 'tok_test_123456', paymentMethodId: 'visa' });
      const row = JSON.stringify(await stored(orderId));
      expect(row).not.toContain('tok_test_123456');
    });

    it('cartão recusado mantém o pedido e permite nova tentativa no MESMO pedido', async () => {
      gateway.cardResult = 'refused';
      const orderId = await newOrder();
      const refused = await pay(orderId, card);
      expect(refused.status).toBe(201);
      expect(refused.body).toMatchObject({ status: 'received', payment: { status: 'refused', failureReason: 'cc_rejected_insufficient_amount' } });

      gateway.cardResult = 'approved';
      const retry = await pay(orderId, { ...card, cardToken: 'tok_test_other1' });
      expect(retry.body).toMatchObject({ id: orderId, status: 'paid', payment: { status: 'approved' } });
      expect(await t.prisma.order.count()).toBe(1);
      expect((await stored(orderId)).payments.map(payment => [payment.attempt, payment.status])).toEqual([[1, 'refused'], [2, 'approved']]);
    });

    it('trocar Pix pendente por cartão cancela a cobrança Pix antes de cobrar o cartão', async () => {
      const orderId = await newOrder();
      await pay(orderId);
      const response = await pay(orderId, card);
      expect(response.body.status).toBe('paid');
      expect(gateway.cancelled).toEqual(['fake-1']);
      expect((await stored(orderId)).payments.map(payment => payment.status)).toEqual(['cancelled', 'approved']);
    });

    it('se o Pix foi pago enquanto o cliente trocava para cartão, não cobra de novo', async () => {
      const orderId = await newOrder();
      await pay(orderId);
      gateway.set(gateway.lastId, { status: 'approved' });
      const response = await pay(orderId, card);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ALREADY_PAID');
      expect(gateway.created).toHaveLength(1);
      expect((await stored(orderId)).status).toBe('paid');
    });

    it('gateway que recusa antes de cobrar encerra a tentativa e libera outra, sem aprovar nada', async () => {
      const orderId = await newOrder();
      gateway.createFailure = 'not_processed';
      const failed = await pay(orderId, card);
      expect(failed.status).toBe(502);
      expect(failed.body.code).toBe('PAYMENT_GATEWAY_ERROR');
      expect((await stored(orderId)).payments.map(payment => [payment.status, payment.failureReason])).toEqual([['refused', 'gateway_not_processed']]);
      expect((await stored(orderId)).status).toBe('received');
      expect((await pay(orderId, card)).body.status).toBe('paid');
      expect(gateway.charges).toBe(1);
    });
  });

  describe('webhook', () => {
    it('assinatura inválida ou ausente é rejeitada e nada muda', async () => {
      const orderId = await newOrder();
      await pay(orderId);
      gateway.set(gateway.lastId, { status: 'approved' });
      expect((await webhook(gateway.lastId, 'ts=1,v1=forjada')).status).toBe(401);
      expect((await t.browser().post(`/api/payments/webhook?type=payment&data.id=${gateway.lastId}`).send({})).status).toBe(401);
      expect((await stored(orderId)).status).toBe('received');
    });

    it('notificação autêntica confirma o pagamento consultando o gateway; reentregas não repetem o efeito', async () => {
      const orderId = await newOrder();
      await pay(orderId);
      // O corpo da notificação diz "approved", mas o gateway ainda diz pendente: vale o gateway.
      const spoofed = await t.browser().post(`/api/payments/webhook?type=payment&data.id=${gateway.lastId}`).set('x-signature', VALID_SIGNATURE).send({ type: 'payment', status: 'approved', data: { id: gateway.lastId } });
      expect(spoofed.status).toBe(200);
      expect((await stored(orderId)).status).toBe('received');

      gateway.set(gateway.lastId, { status: 'approved' });
      const deliveries = await Promise.all([webhook(gateway.lastId), webhook(gateway.lastId), webhook(gateway.lastId)]);
      expect(deliveries.map(delivery => delivery.status)).toEqual([200, 200, 200]);
      const row = await stored(orderId);
      expect(row.status).toBe('paid');
      expect(row.payments).toHaveLength(1);
      const approvedAt = row.payments[0]?.approvedAt;
      await webhook(gateway.lastId);
      expect((await stored(orderId)).payments[0]?.approvedAt).toEqual(approvedAt);
    });

    it('valor aprovado diferente do pedido não confirma o pagamento', async () => {
      const orderId = await newOrder();
      await pay(orderId);
      gateway.set(gateway.lastId, { status: 'approved', amountCents: 1 });
      await webhook(gateway.lastId);
      expect((await stored(orderId)).status).toBe('received');
      expect((await stored(orderId)).payments[0]?.status).toBe('pending');
    });

    it('ignora notificações de outros tipos e pagamentos que não são deste app (inclusive referência que não é UUID)', async () => {
      expect((await t.browser().post('/api/payments/webhook?type=merchant_order&data.id=1').set('x-signature', VALID_SIGNATURE).send({})).status).toBe(200);
      const foreign = { statusDetail: null, amountCents: 2000, pix: null, status: 'approved' as const };
      gateway.payments.set('fake-98', { id: 'fake-98', ...foreign, externalReference: '00000000-0000-4000-8000-000000000000' });
      gateway.payments.set('fake-99', { id: 'fake-99', ...foreign, externalReference: 'pedido-123-outra-integracao' });
      expect((await webhook('fake-98')).status).toBe(200);
      expect((await webhook('fake-99')).status).toBe(200);
      expect(await t.prisma.payment.count()).toBe(0);
    });

    it('estorno informado pelo gateway cancela o pedido pago', async () => {
      const orderId = await newOrder();
      await pay(orderId, card);
      gateway.set(gateway.lastId, { status: 'refunded' });
      await webhook(gateway.lastId);
      const row = await stored(orderId);
      expect(row.status).toBe('cancelled');
      expect(row.payments[0]?.status).toBe('refunded');
    });
  });

  describe('estorno pela equipe', () => {
    const refund = async (agent: Agent, orderId: string) => agent.post(`/api/establishments/${world.estA.id}/orders/${orderId}/refund`).set(CSRF);

    it('só quem tem a permissão de estorno pode estornar; o gateway devolve o valor e o pedido é cancelado', async () => {
      const orderId = await newOrder();
      await pay(orderId, card);
      const attendant = await login(t.browser(), world.attendantA.email);
      expect((await refund(attendant, orderId)).status).toBe(403);
      expect(gateway.refunded).toHaveLength(0);

      const manager = await login(t.browser(), world.managerA.email);
      const done = await refund(manager, orderId);
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ status: 'cancelled', payment: { status: 'refunded' } });
      expect(gateway.refunded).toEqual([gateway.lastId]);
      expect((await refund(manager, orderId)).status).toBe(422);
    });

    it('não estorna pedido não pago, já pronto ou de outra casa', async () => {
      const manager = await login(t.browser(), world.managerA.email);
      const unpaid = await newOrder();
      expect((await refund(manager, unpaid)).body.code).toBe('ORDER_NOT_REFUNDABLE');

      const paid = await newOrder();
      await pay(paid, card);
      await t.prisma.order.update({ where: { id: paid }, data: { status: 'ready' } });
      expect((await refund(manager, paid)).status).toBe(422);
      expect(gateway.refunded).toHaveLength(0);

      await t.prisma.order.update({ where: { id: paid }, data: { status: 'paid' } });
      const otherManager = await login(t.browser(), world.managerB.email);
      expect((await otherManager.post(`/api/establishments/${world.estB.id}/orders/${paid}/refund`).set(CSRF)).status).toBe(404);
    });
  });
});
