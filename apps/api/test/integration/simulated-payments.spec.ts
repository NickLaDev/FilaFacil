import { io, type Socket } from 'socket.io-client';
import { REALTIME_EVENTS } from '@filafacil/shared';
import { PaymentGateway } from '../../src/modules/payments/payment-gateway.js';
import { SimulatedPaymentGateway, SIMULATED_ID_PREFIX } from '../../src/modules/payments/simulated-payment.gateway.js';
import { resetDatabase } from '../helpers/database.js';
import { FakePaymentGateway } from '../helpers/fake-gateway.js';
import { createWorld, login, PASSWORD, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, placeOrder, verifyEmail } from '../helpers/orders.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

/** Gateway simulado (demonstração acadêmica): nenhuma transação aqui tem valor financeiro. */
describe('Pagamento simulado (ficha 04, demonstração)', () => {
  let t: TestApp;
  let gateway: SimulatedPaymentGateway;
  let world: World;
  let extra: Awaited<ReturnType<typeof createOrdersWorld>>;
  let client: Agent;
  const sockets: Socket[] = [];
  const previous = { provider: process.env.PAYMENT_PROVIDER, allow: process.env.ALLOW_SIMULATED_PAYMENTS };

  beforeAll(async () => {
    process.env.PAYMENT_PROVIDER = 'simulated';
    process.env.ALLOW_SIMULATED_PAYMENTS = 'true';
    t = await createTestApp();
    gateway = t.app.get(PaymentGateway) as SimulatedPaymentGateway;
  });
  afterAll(async () => {
    process.env.PAYMENT_PROVIDER = previous.provider;
    process.env.ALLOW_SIMULATED_PAYMENTS = previous.allow;
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    extra = await createOrdersWorld(t.prisma, world);
    await verifyEmail(t.prisma, world.client.id);
    client = await login(t.browser(), world.client.email);
    ledger().clear();
  });
  afterEach(() => sockets.splice(0).forEach(socket => socket.close()));

  /** O ledger em memória é privado: limpar equivale a reiniciar a API. */
  const ledger = () => (gateway as unknown as { ledger: Map<string, unknown> }).ledger;
  const newOrder = async (agent: Agent = client) => (await placeOrder(agent, { establishmentId: world.estA.id, tableId: extra.tableA.id, items: [{ menuItemId: world.itemA.id, quantity: 2 }] }, CSRF)).body.id as string;
  const pay = (orderId: string, body: object, agent: Agent = client) => agent.post(`/api/orders/${orderId}/payments`).set(CSRF).send(body);
  const card = (scenario: string, method: 'credit' | 'debit' = 'credit') => ({ method, cardToken: scenario, paymentMethodId: 'simulated' });
  const confirm = (orderId: string, agent: Agent = client) => agent.post(`/api/orders/${orderId}/payments/demo-confirm`).set(CSRF);
  const rows = (orderId: string) => t.prisma.payment.findMany({ where: { orderId }, orderBy: { attempt: 'asc' } });
  const refund = (agent: Agent, orderId: string) => agent.post(`/api/establishments/${world.estA.id}/orders/${orderId}/refund`).set(CSRF);

  it('informa ao app qual provedor está ativo', async () => {
    expect((await t.browser().get('/api/auth/providers')).body.paymentProvider).toBe('simulated');
  });

  describe('cartão', () => {
    it.each(['credit', 'debit'] as const)('cartão de %s aprovado: pagamento aprovado, pedido pago e comprovante no histórico', async method => {
      const orderId = await newOrder();
      const response = await pay(orderId, card('sim_approved', method));
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        status: 'paid',
        totalCents: 4000,
        payment: { method, status: 'approved', amountCents: 4000, simulated: true, pix: null },
      });
      expect(response.body.payment.transactionId).toMatch(new RegExp(`^${SIMULATED_ID_PREFIX}`));
      expect(response.body.payment.approvedAt).toEqual(expect.any(String));

      // Persistido no banco e presente no histórico do cliente (comprovante).
      expect((await rows(orderId))[0]).toMatchObject({ status: 'approved', method });
      const history = await client.get('/api/orders');
      expect(history.body.items[0]).toMatchObject({ id: orderId, status: 'paid', payment: { status: 'approved', simulated: true } });
    });

    it('cartão recusado mantém o pedido e uma nova tentativa no MESMO pedido funciona', async () => {
      const orderId = await newOrder();
      const refused = await pay(orderId, card('sim_refused'));
      expect(refused.body).toMatchObject({ status: 'received', payment: { status: 'refused', failureReason: 'cc_rejected_insufficient_amount', simulated: true } });

      const retry = await pay(orderId, card('sim_approved', 'debit'));
      expect(retry.body).toMatchObject({ id: orderId, status: 'paid', payment: { status: 'approved' } });
      expect(await t.prisma.order.count()).toBe(1);
      expect((await rows(orderId)).map(row => [row.attempt, row.status])).toEqual([[1, 'refused'], [2, 'approved']]);
    });

    it('falha de processamento responde 502, encerra a tentativa e permite tentar de novo', async () => {
      const orderId = await newOrder();
      const failed = await pay(orderId, card('sim_error'));
      expect(failed.status).toBe(502);
      expect(failed.body.code).toBe('PAYMENT_GATEWAY_ERROR');
      expect((await rows(orderId)).map(row => [row.status, row.failureReason])).toEqual([['refused', 'gateway_not_processed']]);
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('received');
      expect((await pay(orderId, card('sim_approved'))).body.status).toBe('paid');
    });

    it('só os cenários simulados valem: um token qualquer é recusado sem aprovar nada', async () => {
      const orderId = await newOrder();
      const response = await pay(orderId, { method: 'credit', cardToken: 'tok_123456789012', paymentMethodId: 'visa' });
      expect(response.status).toBe(502);
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('received');
    });

    it('pagamentos simultâneos do mesmo pedido geram uma única aprovação', async () => {
      const orderId = await newOrder();
      await Promise.all([pay(orderId, card('sim_approved')), pay(orderId, card('sim_approved')), pay(orderId, card('sim_approved'))]);
      expect((await rows(orderId)).filter(row => row.status === 'approved')).toHaveLength(1);
    });

    it('a verificação de contato continua obrigatória: conta não verificada não paga', async () => {
      await t.prisma.user.update({ where: { id: world.client.id }, data: { emailVerifiedAt: null, phoneVerifiedAt: null } });
      const orderId = await newOrder();
      const response = await pay(orderId, card('sim_approved'));
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('CONTACT_NOT_VERIFIED');
      expect(await t.prisma.payment.count()).toBe(0);
    });
  });

  describe('Pix', () => {
    it('cria uma cobrança pendente com referência claramente falsa (não é payload Pix)', async () => {
      const orderId = await newOrder();
      const response = await pay(orderId, { method: 'pix' });
      expect(response.status).toBe(201);
      expect(response.body.status).toBe('received');
      expect(response.body.payment).toMatchObject({ method: 'pix', status: 'pending', simulated: true });
      expect(response.body.payment.pix.copyPaste).toMatch(/^SIMULADO-NAO-PAGAVEL-/);
      expect(response.body.payment.pix.copyPaste).not.toMatch(/^000201/);
      expect(response.body.payment.pix.qrBase64).toBeNull();
    });

    it('o dono confirma: pagamento aprovado, pedido pago, equipe vê o pedido e o histórico tem o comprovante', async () => {
      const orderId = await newOrder();
      await pay(orderId, { method: 'pix' });
      const confirmed = await confirm(orderId);
      expect(confirmed.status).toBe(200);
      expect(confirmed.body).toMatchObject({ status: 'paid', payment: { status: 'approved', simulated: true } });
      expect((await rows(orderId))[0]).toMatchObject({ status: 'approved' });

      const attendant = await login(t.browser(), world.attendantA.email);
      const queue = await attendant.get(`/api/establishments/${world.estA.id}/orders`);
      expect(queue.body.items.map((order: { id: string }) => order.id)).toEqual([orderId]);
      expect((await client.get('/api/orders')).body.items[0]).toMatchObject({ id: orderId, payment: { status: 'approved' } });
    });

    it('confirmar duas vezes não repete o efeito', async () => {
      const orderId = await newOrder();
      await pay(orderId, { method: 'pix' });
      expect((await confirm(orderId)).status).toBe(200);
      const again = await confirm(orderId);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('NO_PENDING_PIX');
      expect((await rows(orderId)).filter(row => row.status === 'approved')).toHaveLength(1);
    });

    it('só o dono confirma: outro usuário recebe 404 e visitante 401 (nada é aprovado)', async () => {
      const orderId = await newOrder();
      await pay(orderId, { method: 'pix' });
      const stranger = await login(t.browser(), extra.otherClient.email);
      expect((await confirm(orderId, stranger)).status).toBe(404);
      expect((await confirm(orderId, t.browser())).status).toBe(401);
      const manager = await login(t.browser(), world.managerA.email);
      expect((await confirm(orderId, manager)).status).toBe(404);
      expect((await rows(orderId))[0]?.status).toBe('pending');
    });

    it('confirmação inválida: sem pagamento, pagamento de cartão ou Pix já expirado/cancelado responde 409', async () => {
      const noPayment = await newOrder();
      expect((await confirm(noPayment)).body.code).toBe('NO_PENDING_PIX');

      const paidByCard = await newOrder();
      await pay(paidByCard, card('sim_approved'));
      expect((await confirm(paidByCard)).status).toBe(409);

      const cancelledPix = await newOrder();
      await pay(cancelledPix, { method: 'pix' });
      await t.prisma.payment.updateMany({ where: { orderId: cancelledPix }, data: { status: 'cancelled' } });
      expect((await confirm(cancelledPix)).status).toBe(409);
    });

    it('avisa o cliente e a equipe em tempo real quando o Pix é confirmado', async () => {
      async function connect(email: string | null) {
        if (!email) throw new Error('Usuário de teste sem e-mail.');
        const response = await t.browser().post('/api/auth/login').set(CSRF).send({ email, password: PASSWORD });
        const cookie = ([] as string[]).concat(response.headers['set-cookie'] ?? []).map(c => c.split(';')[0]).join('; ');
        const socket = io(`http://localhost:${t.port}/realtime`, { path: '/api/socket.io', transports: ['websocket'], extraHeaders: { cookie } });
        sockets.push(socket);
        await new Promise<void>(resolve => socket.on('connect', () => resolve()));
        return socket;
      }
      const owner = await connect(world.client.email);
      const staff = await connect(world.attendantA.email);
      expect(await staff.emitWithAck('subscribe', { establishmentId: world.estA.id })).toEqual({ ok: true });
      const orderId = await newOrder();
      await pay(orderId, { method: 'pix' });

      const received: unknown[][] = [[], []];
      owner.on(REALTIME_EVENTS.orderUpdated, payload => received[0]?.push(payload));
      staff.on(REALTIME_EVENTS.orderUpdated, payload => received[1]?.push(payload));
      await confirm(orderId);
      await vi.waitFor(() => expect(received[0]?.length).toBeGreaterThanOrEqual(1));
      await vi.waitFor(() => expect(received[1]?.length).toBeGreaterThanOrEqual(1));
      expect(received[0]?.at(-1)).toEqual({ establishmentId: world.estA.id, orderId });
    });
  });

  describe('estorno', () => {
    it('só quem tem permissão estorna; o pedido é cancelado e o comprovante continua no histórico', async () => {
      const orderId = await newOrder();
      await pay(orderId, card('sim_approved'));
      const attendant = await login(t.browser(), world.attendantA.email);
      expect((await refund(attendant, orderId)).status).toBe(403);
      expect((await rows(orderId))[0]?.status).toBe('approved');

      const manager = await login(t.browser(), world.managerA.email);
      const done = await refund(manager, orderId);
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ status: 'cancelled', payment: { status: 'refunded', simulated: true } });
      expect((await rows(orderId))[0]).toMatchObject({ status: 'refunded' });
      expect((await rows(orderId))[0]?.refundedAt).toBeInstanceOf(Date);

      const history = await client.get('/api/orders');
      expect(history.body.items[0]).toMatchObject({ id: orderId, status: 'cancelled', payment: { status: 'refunded', simulated: true } });
    });

    it('estorno repetido é recusado e o simulador não estorna duas vezes', async () => {
      const orderId = await newOrder();
      await pay(orderId, card('sim_approved'));
      const manager = await login(t.browser(), world.managerA.email);
      expect((await refund(manager, orderId)).status).toBe(200);
      const again = await refund(manager, orderId);
      expect(again.status).toBe(422);
      expect(again.body.code).toBe('ORDER_NOT_REFUNDABLE');

      // Direto no simulador: a segunda chamada falha (nada de estorno em duplicidade).
      const providerId = (await rows(orderId))[0]?.providerPaymentId as string;
      await expect(gateway.refundPayment(providerId)).rejects.toThrow(/já estornada/);
    });

    it('estorna também um Pix simulado confirmado', async () => {
      const orderId = await newOrder();
      await pay(orderId, { method: 'pix' });
      await confirm(orderId);
      const manager = await login(t.browser(), world.managerA.email);
      expect((await refund(manager, orderId)).body).toMatchObject({ status: 'cancelled', payment: { status: 'refunded' } });
    });
  });

  describe('reinício da API (o ledger é só espelho do PostgreSQL)', () => {
    it('Pix pendente sobrevive ao reinício e ainda pode ser confirmado', async () => {
      const orderId = await newOrder();
      const created = await pay(orderId, { method: 'pix' });
      ledger().clear(); // reinício
      const synced = await client.post(`/api/orders/${orderId}/payments/sync`).set(CSRF);
      expect(synced.body.payment).toMatchObject({ status: 'pending', transactionId: created.body.payment.transactionId });
      expect((await confirm(orderId)).body).toMatchObject({ status: 'paid', payment: { status: 'approved' } });
    });

    it('pagamento aprovado e estorno funcionam depois do reinício, sem duplicar cobrança', async () => {
      const orderId = await newOrder();
      await pay(orderId, card('sim_approved'));
      ledger().clear();
      // Pagar de novo o mesmo pedido já pago não cobra nada.
      expect((await pay(orderId, card('sim_approved'))).body.code).toBe('ORDER_NOT_PAYABLE');
      const manager = await login(t.browser(), world.managerA.email);
      expect((await refund(manager, orderId)).body).toMatchObject({ status: 'cancelled', payment: { status: 'refunded' } });
      expect(await rows(orderId)).toHaveLength(1);
    });

    it('uma aprovação que não foi gravada no banco não sobrevive ao reinício (o banco manda)', async () => {
      const orderId = await newOrder();
      await pay(orderId, { method: 'pix' });
      const providerId = (await rows(orderId))[0]?.providerPaymentId as string;
      await gateway.confirmPix(providerId); // "marcou" no ledger, mas o apply() ainda não gravou
      ledger().clear(); // reinício antes de gravar
      expect((await gateway.getPayment(providerId)).status).toBe('pending');
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('received');
    });
  });

  describe('fora do modo simulado', () => {
    it('a rota de confirmação responde 404 com outro gateway (ex.: Mercado Pago)', async () => {
      const other = await createTestApp(undefined, new FakePaymentGateway());
      try {
        const agent = await login(other.browser(), world.client.email);
        const orderId = (await placeOrder(agent, { establishmentId: world.estA.id, items: [{ menuItemId: world.itemA.id, quantity: 1 }] }, CSRF)).body.id as string;
        const response = await agent.post(`/api/orders/${orderId}/payments/demo-confirm`).set(CSRF);
        expect(response.status).toBe(404);
      } finally {
        await other.close();
      }
    });

    it('sem provider configurado o pagamento é recusado (503) em vez de simulado', async () => {
      process.env.PAYMENT_PROVIDER = 'none';
      process.env.ALLOW_SIMULATED_PAYMENTS = 'false';
      const disabled = await createTestApp();
      try {
        const agent = await login(disabled.browser(), world.client.email);
        const orderId = (await placeOrder(agent, { establishmentId: world.estA.id, items: [{ menuItemId: world.itemA.id, quantity: 1 }] }, CSRF)).body.id as string;
        expect((await agent.post(`/api/orders/${orderId}/payments`).set(CSRF).send(card('sim_approved'))).status).toBe(503);
        expect((await agent.post(`/api/orders/${orderId}/payments/demo-confirm`).set(CSRF)).status).toBe(404);
      } finally {
        process.env.PAYMENT_PROVIDER = 'simulated';
        process.env.ALLOW_SIMULATED_PAYMENTS = 'true';
        await disabled.close();
      }
    });
  });
});
