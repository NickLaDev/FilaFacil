import { resetDatabase } from '../helpers/database.js';
import { FakePaymentGateway, VALID_SIGNATURE } from '../helpers/fake-gateway.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, placeOrder, verifyEmail } from '../helpers/orders.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

/**
 * Resultado incerto do gateway, estorno incerto e pedidos velhos (estabilização do bloco 1).
 * O dublê imita o Mercado Pago: a mesma chave devolve a cobrança já criada e uma chave com corpo diferente é
 * recusada — então qualquer repetição indevida aparece como falha aqui.
 */
describe('Consistência de pagamento, estorno e pedidos velhos', () => {
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

  const items = () => [{ menuItemId: world.itemA.id, quantity: 1 }];
  const newOrder = async () => (await placeOrder(client, { establishmentId: world.estA.id, items: items() }, CSRF)).body.id as string;
  const pay = (orderId: string, body: object = { method: 'pix' }) => client.post(`/api/orders/${orderId}/payments`).set(CSRF).send(body);
  const sync = (orderId: string) => client.post(`/api/orders/${orderId}/payments/sync`).set(CSRF);
  const card = (token = 'tok_test_123456') => ({ method: 'credit', cardToken: token, paymentMethodId: 'visa' });
  const webhook = (dataId: string) =>
    t.browser().post(`/api/payments/webhook?type=payment&data.id=${dataId}`).set('x-signature', VALID_SIGNATURE).set('x-request-id', 'req-1').send({ type: 'payment', data: { id: dataId } });
  const rows = (orderId: string) => t.prisma.payment.findMany({ where: { orderId }, orderBy: { attempt: 'asc' } });
  const orderRow = (orderId: string) => t.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  /** Faz as tentativas passarem do prazo em que a requisição original ainda poderia estar em andamento. */
  const age = () => t.prisma.payment.updateMany({ data: { createdAt: new Date(Date.now() - 60_000) } });
  /** Toda cobrança que existe no gateway tem a sua linha local (com a referência certa). */
  async function expectNoOrphans() {
    for (const charge of gateway.payments.values()) {
      const row = await t.prisma.payment.findUnique({ where: { id: charge.externalReference as string } });
      expect(row, `cobrança ${charge.id} sem linha local`).not.toBeNull();
    }
  }
  const manager = () => login(t.browser(), world.managerA.email);
  const refund = (agent: Agent, orderId: string) => agent.post(`/api/establishments/${world.estA.id}/orders/${orderId}/refund`).set(CSRF);

  describe('resultado incerto do gateway (C1)', () => {
    it('a tentativa é gravada antes da chamada: a cobrança que o gateway criou sempre tem linha local', async () => {
      const orderId = await newOrder();
      await pay(orderId, card());
      const [row] = await rows(orderId);
      expect(gateway.created[0]).toMatchObject({ reference: row?.id, idempotencyKey: `payment-${row?.id}` });
      await expectNoOrphans();
    });

    it('cobra e dá timeout, mas o gateway confirma pela busca: pedido pago, uma cobrança só', async () => {
      gateway.createFailure = 'timeout_after_charge';
      const orderId = await newOrder();
      const response = await pay(orderId, card());
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ status: 'paid', payment: { status: 'approved', transactionId: 'fake-1' } });
      expect(gateway.charges).toBe(1);
      expect(gateway.created).toHaveLength(1);
      expect((await rows(orderId))[0]?.providerPaymentId).toBe('fake-1');
      await expectNoOrphans();
    });

    it('cobra, dá timeout e a busca também falha: fica pendente sem id, e nenhuma repetição cobra de novo', async () => {
      gateway.createFailure = 'timeout_after_charge';
      gateway.searchFails = true;
      const orderId = await newOrder();
      const first = await pay(orderId, card());
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ status: 'received', payment: { status: 'pending', transactionId: null } });
      expect((await rows(orderId))[0]).toMatchObject({ status: 'pending', providerPaymentId: null });

      // Repetições com outro token, dentro e fora da janela de requisição em andamento: nada novo é cobrado.
      for (const token of ['tok_outro_1111', 'tok_outro_2222']) {
        const retry = await pay(orderId, card(token));
        expect(retry.status).toBe(201);
        expect(retry.body.payment).toMatchObject({ status: 'pending', transactionId: null });
        await age();
      }
      expect(gateway.created).toHaveLength(1);
      expect(gateway.charges).toBe(1);
      expect(await rows(orderId)).toHaveLength(1);
      expect((await orderRow(orderId)).status).toBe('received');
    });

    it('retry depois do resultado incerto concilia pela busca e confirma o pagamento já feito', async () => {
      gateway.createFailure = 'timeout_after_charge';
      gateway.searchFails = true;
      const orderId = await newOrder();
      await pay(orderId, card());
      await age();
      gateway.searchFails = false;

      const retry = await pay(orderId, card('tok_novo_999999'));
      expect(retry.body).toMatchObject({ status: 'paid', payment: { status: 'approved', transactionId: 'fake-1' } });
      // O token novo nunca foi usado: a cobrança original foi encontrada, não repetida.
      expect(gateway.created).toHaveLength(1);
      expect(gateway.charges).toBe(1);
      expect(await rows(orderId)).toHaveLength(1);
      await expectNoOrphans();
    });

    it('a sincronização também concilia um resultado desconhecido', async () => {
      gateway.createFailure = 'timeout_after_charge';
      gateway.searchFails = true;
      const orderId = await newOrder();
      await pay(orderId, card());
      await age();
      gateway.searchFails = false;
      const synced = await sync(orderId);
      expect(synced.body).toMatchObject({ status: 'paid', payment: { status: 'approved' } });
      expect(gateway.charges).toBe(1);
    });

    it('webhook atrasado depois do timeout liga a cobrança à linha local e paga o pedido', async () => {
      gateway.createFailure = 'timeout_after_charge';
      gateway.searchFails = true;
      const orderId = await newOrder();
      await pay(orderId, card());
      expect((await orderRow(orderId)).status).toBe('received');

      expect((await webhook('fake-1')).status).toBe(200);
      const [row] = await rows(orderId);
      expect(row).toMatchObject({ status: 'approved', providerPaymentId: 'fake-1' });
      expect((await orderRow(orderId)).status).toBe('paid');
      expect(gateway.charges).toBe(1);
      expect((await pay(orderId, card())).body.code).toBe('ORDER_NOT_PAYABLE');
    });

    it('retries simultâneos durante a incerteza geram uma única cobrança e uma única linha', async () => {
      gateway.createFailure = 'timeout_after_charge';
      gateway.searchFails = true;
      const orderId = await newOrder();
      const results = await Promise.all([pay(orderId, card('tok_a_11111111')), pay(orderId, card('tok_b_22222222')), pay(orderId, card('tok_c_33333333')), pay(orderId)]);
      expect(results.map(result => result.status)).toEqual([201, 201, 201, 201]);
      expect(gateway.charges).toBe(1);
      expect(gateway.created).toHaveLength(1);
      expect(await rows(orderId)).toHaveLength(1);
    });

    it('timeout antes de a cobrança existir: o provedor que não confirma mantém o estado incerto (cartão não é liberado)', async () => {
      gateway.createFailure = 'timeout_before_charge';
      gateway.searchFails = true;
      const orderId = await newOrder();
      await pay(orderId, card());
      await age();
      // Provedor sem resposta: nenhuma nova cobrança.
      expect((await pay(orderId, card('tok_novo_111111'))).body.payment).toMatchObject({ status: 'pending', transactionId: null });
      // Provedor responde "não há cobrança": cartão continua bloqueado (a busca pode estar defasada).
      gateway.searchFails = false;
      expect((await pay(orderId, card('tok_novo_222222'))).body.payment).toMatchObject({ status: 'pending', transactionId: null });
      expect(gateway.created).toHaveLength(1);
      expect(gateway.charges).toBe(0);
      expect(await rows(orderId)).toHaveLength(1);
    });

    it('Pix incerto sem cobrança no gateway é encerrado e libera um novo código (ninguém viu o código perdido)', async () => {
      gateway.createFailure = 'timeout_before_charge';
      gateway.searchFails = true;
      const orderId = await newOrder();
      const first = await pay(orderId);
      expect(first.body.payment).toMatchObject({ status: 'pending', pix: null, transactionId: null });
      await age();
      gateway.searchFails = false;

      const second = await pay(orderId);
      expect(second.status).toBe(201);
      expect(second.body.payment.pix.copyPaste).toBe('000201-pix-1');
      expect((await rows(orderId)).map(row => [row.attempt, row.status, row.failureReason])).toEqual([[1, 'cancelled', 'unconfirmed'], [2, 'pending', null]]);
      expect(gateway.charges).toBe(1);
    });

    it('Pix cobrado com resposta perdida é recuperado pela busca e mostra o MESMO código', async () => {
      gateway.createFailure = 'timeout_after_charge';
      gateway.searchFails = true;
      const orderId = await newOrder();
      await pay(orderId);
      await age();
      gateway.searchFails = false;
      const synced = await sync(orderId);
      expect(synced.body.payment).toMatchObject({ status: 'pending', transactionId: 'fake-1' });
      expect(synced.body.payment.pix.copyPaste).toBe('000201-pix-1');
      // Pagar de novo devolve esse Pix, sem outra cobrança.
      expect((await pay(orderId)).body.payment.pix.copyPaste).toBe('000201-pix-1');
      expect(gateway.charges).toBe(1);
      expect(gateway.created).toHaveLength(1);
      await expectNoOrphans();
    });

    it('requisição ainda em andamento (tentativa recém-criada) não é tocada pela conciliação', async () => {
      gateway.createFailure = 'timeout_after_charge';
      gateway.searchFails = true;
      const orderId = await newOrder();
      await pay(orderId, card());
      gateway.searchFails = false;
      gateway.searches.length = 0;
      await sync(orderId);
      expect(gateway.searches).toHaveLength(0);
    });
  });

  describe('estorno incerto (C3)', () => {
    const paidWithCard = async () => {
      const orderId = await newOrder();
      await pay(orderId, card());
      return orderId;
    };

    it('estorno feito no gateway com a resposta perdida é confirmado pela consulta, sem estornar duas vezes', async () => {
      const orderId = await paidWithCard();
      gateway.refundTimesOutAfterRefunding = true;
      const response = await refund(await manager(), orderId);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: 'cancelled', payment: { status: 'refunded' } });
      expect(gateway.refunded).toHaveLength(1);
    });

    it('sem confirmação nenhuma o estorno fica registrado como pendente e a nova tentativa fecha o estado sem duplicar', async () => {
      const orderId = await paidWithCard();
      gateway.refundTimesOutAfterRefunding = true;
      gateway.getPaymentFails = true;
      const agent = await manager();
      const uncertain = await refund(agent, orderId);
      expect(uncertain.status).toBe(502);
      expect(uncertain.body.code).toBe('REFUND_UNCERTAIN');
      const [row] = await rows(orderId);
      expect(row).toMatchObject({ status: 'approved' });
      expect(row?.refundRequestedAt).toBeInstanceOf(Date);
      expect((await orderRow(orderId)).status).toBe('paid');
      const list = await agent.get(`/api/establishments/${world.estA.id}/orders`);
      expect(list.body.items[0]).toMatchObject({ refundPending: true });

      gateway.getPaymentFails = false;
      const retry = await refund(agent, orderId); // o gateway responde "já estornado": tratado como sucesso
      expect(retry.status).toBe(200);
      expect(retry.body).toMatchObject({ status: 'cancelled', refundPending: false });
      expect(gateway.refunded).toHaveLength(1);
    });

    it('o webhook recupera o estorno pendente', async () => {
      const orderId = await paidWithCard();
      gateway.refundTimesOutAfterRefunding = true;
      gateway.getPaymentFails = true;
      await refund(await manager(), orderId);
      gateway.getPaymentFails = false;
      await webhook(gateway.lastId);
      expect(await rows(orderId).then(list => list[0]?.status)).toBe('refunded');
      expect((await orderRow(orderId)).status).toBe('cancelled');
    });

    it('a sincronização do cliente também recupera o estorno pendente', async () => {
      const orderId = await paidWithCard();
      gateway.refundTimesOutAfterRefunding = true;
      gateway.getPaymentFails = true;
      await refund(await manager(), orderId);
      gateway.getPaymentFails = false;
      expect((await sync(orderId)).body).toMatchObject({ status: 'cancelled', payment: { status: 'refunded' } });
    });

    it('estorno já pedido continua repetível mesmo que o pedido tenha avançado de etapa', async () => {
      const orderId = await paidWithCard();
      gateway.refundTimesOutAfterRefunding = true;
      gateway.getPaymentFails = true;
      const agent = await manager();
      await refund(agent, orderId);
      await t.prisma.order.update({ where: { id: orderId }, data: { status: 'ready' } });
      gateway.getPaymentFails = false;
      expect((await refund(agent, orderId)).status).toBe(200);
      // Sem pedido de estorno anterior, pedido pronto continua não estornável.
      const other = await paidWithCard2();
      await t.prisma.order.update({ where: { id: other }, data: { status: 'ready' } });
      expect((await refund(agent, other)).status).toBe(422);
    });

    const advance = (agent: Agent, orderId: string, status: string) =>
      agent.patch(`/api/establishments/${world.estA.id}/orders/${orderId}/status`).set(CSRF).send({ status });

    it('com estorno em andamento o pedido não avança de etapa até o estorno ser concluído', async () => {
      const orderId = await paidWithCard();
      const agent = await manager();
      expect((await advance(agent, orderId, 'preparing')).status).toBe(200);
      gateway.refundTimesOutAfterRefunding = true;
      gateway.getPaymentFails = true;
      expect((await refund(agent, orderId)).status).toBe(502);
      const blocked = await advance(agent, orderId, 'ready');
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('REFUND_IN_PROGRESS');
      expect((await orderRow(orderId)).status).toBe('preparing');
      gateway.getPaymentFails = false;
      expect((await refund(agent, orderId)).status).toBe(200);
      expect((await orderRow(orderId)).status).toBe('cancelled');
    });

    it('estorno e avanço simultâneos: exatamente um vence e o pedido nunca fica entregue/pronto e estornado', async () => {
      const agent = await manager();
      for (let round = 0; round < 8; round += 1) {
        const orderId = (await placeOrder(client, { establishmentId: world.estA.id, items: items() }, CSRF)).body.id as string;
        await pay(orderId, card(`tok_race_${round}_000`));
        await advance(agent, orderId, 'preparing');
        const [refunded, advanced] = await Promise.all([refund(agent, orderId), advance(agent, orderId, 'ready')]);
        const order = await orderRow(orderId);
        const [payment] = await rows(orderId);
        if (order.status === 'cancelled') {
          expect(payment?.status).toBe('refunded');
          expect(refunded.status).toBe(200);
          expect(advanced.status).toBeGreaterThanOrEqual(400);
        } else {
          expect(order.status).toBe('ready');
          expect(payment).toMatchObject({ status: 'approved', refundRequestedAt: null });
          expect(advanced.status).toBe(200);
          expect(refunded.status).toBe(422);
        }
      }
    });

    async function paidWithCard2() {
      const orderId = (await placeOrder(client, { establishmentId: world.estA.id, items: items() }, CSRF)).body.id as string;
      await pay(orderId, card('tok_segundo_9999'));
      return orderId;
    }
  });

  describe('pedidos velhos e estado da casa (C5)', () => {
    it('reenviar o identificador de checkout com outro carrinho é recusado, e o mesmo carrinho devolve o mesmo pedido', async () => {
      const body = { establishmentId: world.estA.id, clientRequestId: 'checkout-conflict-1', items: items() };
      const first = await client.post('/api/orders').set(CSRF).send(body);
      expect(first.status).toBe(201);
      const same = await client.post('/api/orders').set(CSRF).send(body);
      expect(same.body.id).toBe(first.body.id);

      const changed = await client.post('/api/orders').set(CSRF).send({ ...body, items: [{ menuItemId: world.itemA.id, quantity: 3 }] });
      expect(changed.status).toBe(409);
      expect(changed.body.code).toBe('ORDER_CONTENT_CHANGED');
      const otherTotal = await client.post('/api/orders').set(CSRF).send({ ...body, expectedTotalCents: 1 });
      expect(otherTotal.body.code).toBe('PRICE_CHANGED');
      expect(await t.prisma.order.count()).toBe(1);
    });

    it('total diferente do exibido ao pagar é recusado sem chamar o gateway', async () => {
      const orderId = await newOrder();
      const stale = await pay(orderId, { method: 'pix', expectedTotalCents: 999 });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('ORDER_TOTAL_CHANGED');
      expect(gateway.created).toHaveLength(0);
      expect(await t.prisma.payment.count()).toBe(0);
      expect((await pay(orderId, { method: 'pix', expectedTotalCents: 2000 })).status).toBe(201);
    });

    it('preço ou disponibilidade que mudaram desde a criação do pedido impedem a cobrança', async () => {
      const orderId = await newOrder();
      await t.prisma.menuItem.update({ where: { id: world.itemA.id }, data: { priceCents: 2500 } });
      const priced = await pay(orderId);
      expect(priced.status).toBe(409);
      expect(priced.body.code).toBe('PRICE_CHANGED');
      await t.prisma.menuItem.update({ where: { id: world.itemA.id }, data: { priceCents: 2000, available: false } });
      const unavailable = await pay(orderId);
      expect(unavailable.status).toBe(422);
      expect(unavailable.body.code).toBe('ITEM_UNAVAILABLE');
      expect(gateway.created).toHaveLength(0);
      expect((await orderRow(orderId)).status).toBe('received');
    });

    it('pedido não pago há muito tempo expira', async () => {
      const orderId = await newOrder();
      await t.prisma.order.update({ where: { id: orderId }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
      const response = await pay(orderId);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ORDER_EXPIRED');
      expect(gateway.created).toHaveLength(0);
    });

    it('casa pausada ou fechada: nova cobrança é recusada; liberada a casa, o pagamento segue', async () => {
      const orderId = await newOrder();
      await t.prisma.establishment.update({ where: { id: world.estA.id }, data: { ordersPaused: true } });
      const response = await pay(orderId);
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('ESTABLISHMENT_NOT_ACCEPTING_ORDERS');
      expect(gateway.created).toHaveLength(0);
      await t.prisma.establishment.update({ where: { id: world.estA.id }, data: { ordersPaused: false } });
      expect((await pay(orderId)).status).toBe(201);
    });

    it('o que já foi aceito antes da casa fechar não é cancelado: Pix pendente continua e o pedido pago segue na cozinha', async () => {
      const orderId = await newOrder();
      const first = await pay(orderId);
      await t.prisma.establishment.update({ where: { id: world.estA.id }, data: { ordersPaused: true } });
      // Mesmo Pix ainda válido: devolvido, sem nova cobrança e sem exigir a casa aberta.
      const again = await pay(orderId);
      expect(again.status).toBe(201);
      expect(again.body.payment.id).toBe(first.body.payment.id);
      expect(gateway.created).toHaveLength(1);

      gateway.set(gateway.lastId, { status: 'approved' });
      expect((await sync(orderId)).body.status).toBe('paid');

      const attendant = await login(t.browser(), world.attendantA.email);
      const step = await attendant.patch(`/api/establishments/${world.estA.id}/orders/${orderId}/status`).set(CSRF).send({ status: 'preparing' });
      expect(step.status).toBe(200);
      expect((await orderRow(orderId)).status).toBe('preparing');
    });

    it('pedido cancelado, pago ou de outra pessoa não aceita pagamento', async () => {
      const orderId = await newOrder();
      await t.prisma.order.update({ where: { id: orderId }, data: { status: 'cancelled' } });
      expect((await pay(orderId)).body.code).toBe('ORDER_NOT_PAYABLE');
      const paid = await newOrder();
      await pay(paid, card());
      expect((await pay(paid, card('tok_depois_8888'))).body.code).toBe('ORDER_NOT_PAYABLE');
      const stranger = await login(t.browser(), 'outro@test.dev');
      expect((await stranger.post(`/api/orders/${orderId}/payments`).set(CSRF).send({ method: 'pix' })).status).toBe(404);
    });
  });
});
