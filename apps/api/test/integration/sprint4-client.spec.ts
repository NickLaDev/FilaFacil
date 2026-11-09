import sharp from 'sharp';
import { restrictedAllergens } from '@filafacil/shared';
import { resetDatabase } from '../helpers/database.js';
import { FakePaymentGateway } from '../helpers/fake-gateway.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, placeOrder, verifyEmail } from '../helpers/orders.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';
import type { TokenizedCard, TokenizeCardInput } from '../../src/modules/payments/payment-gateway.js';

/** Gateway de teste com cofre de cartões (o simulador real é coberto em simulated-payments.spec.ts). */
class VaultGateway extends FakePaymentGateway {
  override readonly supportsCardVault = true;
  override async tokenizeCard(input: TokenizeCardInput): Promise<TokenizedCard> {
    return { token: `vault_${input.number.slice(-4)}_${Math.random().toString(36).slice(2, 10)}`, brand: 'visa', last4: input.number.slice(-4) };
  }
}

const HOUR = 3_600_000;

describe('Sprint 4 — fichas do cliente (15, 30, 48, 49, 56, 62, 64, 67)', () => {
  let t: TestApp;
  let gateway: VaultGateway;
  let world: World;
  let client: Agent;
  let other: Agent;
  let manager: Agent;
  let attendant: Agent;
  const est = () => `/api/establishments/${world.estA.id}`;
  const card = { method: 'credit', cardToken: 'tok_test_123456', paymentMethodId: 'visa' };

  beforeAll(async () => {
    gateway = new VaultGateway();
    t = await createTestApp(undefined, gateway);
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    const extra = await createOrdersWorld(t.prisma, world);
    await verifyEmail(t.prisma, world.client.id);
    await verifyEmail(t.prisma, extra.otherClient.id);
    client = await login(t.browser(), world.client.email);
    other = await login(t.browser(), extra.otherClient.email);
    manager = await login(t.browser(), world.managerA.email);
    attendant = await login(t.browser(), world.attendantA.email);
    gateway.reset();
    t.email.messages.length = 0;
  });

  const place = async (agent: Agent, extra: object = {}) =>
    placeOrder(agent, { establishmentId: world.estA.id, items: [{ menuItemId: world.itemA.id, quantity: 1 }], ...extra }, CSRF);
  const pay = (agent: Agent, id: string, body: object = card) => agent.post(`/api/orders/${id}/payments`).set(CSRF).send(body);
  const advance = (id: string, status: string) => attendant.patch(`${est()}/orders/${id}/status`).set(CSRF).send({ status });
  const deliver = async (id: string) => {
    for (const status of ['preparing', 'ready', 'delivered']) expect((await advance(id, status)).status).toBe(200);
  };

  describe('cashback (15)', () => {
    const createRule = async (body: object = { name: 'Volta 10%', percent: 10 }) => {
      const res = await manager.post(`${est()}/cashback-rules`).set(CSRF).send(body);
      expect(res.status).toBe(201);
      return res.body as { id: string };
    };

    it('credita só depois de entregue e pago, é idempotente e aparece no perfil; pode ser usado no pedido seguinte', async () => {
      await createRule();
      const order = (await place(client)).body;
      expect(order).toMatchObject({ totalCents: 2000, cashbackEarnCents: 200 });
      expect((await client.get('/api/me/cashback')).body).toMatchObject({ balanceCents: 0, pendingCents: 200 });

      expect((await pay(client, order.id)).status).toBe(201);
      expect((await client.get('/api/me/cashback')).body.balanceCents).toBe(0); // pago, ainda não entregue
      await deliver(order.id);
      const wallet = (await client.get('/api/me/cashback')).body;
      expect(wallet).toMatchObject({ balanceCents: 200, pendingCents: 0 });
      expect(wallet.entries).toHaveLength(1);

      // Sem dupla contagem se a transição for repetida por outro caminho.
      await t.prisma.$transaction(async tx => {
        const { BenefitsService } = await import('../../src/modules/benefits/benefits.service.js');
        const service = t.app.get(BenefitsService);
        expect(await service.earnForOrder(tx, order.id)).toBe(false);
      });

      const second = await place(client, { useCashbackCents: 200, expectedTotalCents: 1800 });
      expect(second.status).toBe(201);
      expect(second.body).toMatchObject({ totalCents: 1800, cashbackUsedCents: 200 });
      expect((await client.get('/api/me/cashback')).body.balanceCents).toBe(0);
    });

    it('recusa usar mais que o saldo e nunca deixa o líquido abaixo de R$ 1,00', async () => {
      await createRule();
      const none = await place(client, { useCashbackCents: 100 });
      expect(none.status).toBe(422);
      expect(none.body.code).toBe('INVALID_CASHBACK');

      await t.prisma.cashbackEntry.create({ data: { userId: world.client.id, orderId: (await place(client)).body.id, type: 'earn', cents: 5000 } });
      const tooMuch = await place(client, { useCashbackCents: 1950 });
      expect(tooMuch.status).toBe(422); // sobraria R$ 0,50
    });

    it('cancelar devolve o saldo usado e reverte o ganho', async () => {
      await createRule();
      const first = (await place(client)).body;
      await pay(client, first.id);
      await deliver(first.id);
      const second = (await place(client, { useCashbackCents: 200 })).body;
      expect((await client.get('/api/me/cashback')).body.balanceCents).toBe(0);
      expect((await client.post(`/api/orders/${second.id}/cancel`).set(CSRF)).status).toBe(200);
      expect((await client.get('/api/me/cashback')).body.balanceCents).toBe(200);
    });

    it('regra por promoção só conta os itens da promoção, enquanto vigente', async () => {
      const itemC = await t.prisma.menuItem.create({ data: { establishmentId: world.estA.id, categoryId: world.itemA.categoryId, name: 'Stout', priceCents: 3000, position: 2 } });
      const promo = await manager.post(`${est()}/promotions`).set(CSRF).send({
        name: 'Semana IPA',
        discountPercent: 10,
        startsAt: new Date(Date.now() - HOUR).toISOString(),
        endsAt: new Date(Date.now() + 24 * HOUR).toISOString(),
        itemIds: [world.itemA.id],
      });
      expect(promo.status).toBe(201);
      await createRule({ name: 'IPA 20%', percent: 20, promotionId: promo.body.id });
      const order = await place(client, { items: [{ menuItemId: world.itemA.id, quantity: 1 }, { menuItemId: itemC.id, quantity: 1 }] });
      // IPA com 10% de desconto = 1800; só ela conta: 20% de 1800 = 360.
      expect(order.body).toMatchObject({ totalCents: 4800, cashbackEarnCents: 360 });
      const rules = await client.get(`/api/restaurants/${world.estA.id}/cashback`);
      expect(rules.body).toEqual([{ name: 'IPA 20%', percent: 20, promotionName: 'Semana IPA' }]);
    });

    it('regras do gestor: percentual limitado, promoção de outra casa recusada, sem acesso do atendente', async () => {
      expect((await manager.post(`${est()}/cashback-rules`).set(CSRF).send({ name: 'X', percent: 80 })).status).toBe(400);
      const foreign = await manager.post(`${est()}/cashback-rules`).set(CSRF).send({ name: 'X', percent: 10, promotionId: '5b0f1e0e-6d62-4f9a-9a58-0c5c5b0b9b11' });
      expect(foreign.status).toBe(422);
      expect((await attendant.get(`${est()}/cashback-rules`)).status).toBe(403);
    });
  });

  describe('cupom de desconto (56)', () => {
    const coupon = async (body: object = {}) => {
      const res = await manager.post(`${est()}/coupons`).set(CSRF).send({
        code: 'bemvindo10',
        discountType: 'percent',
        discountValue: 10,
        startsAt: new Date(Date.now() - HOUR).toISOString(),
        endsAt: new Date(Date.now() + 24 * HOUR).toISOString(),
        ...body,
      });
      expect(res.status).toBe(201);
      return res.body as { id: string; code: string };
    };
    const validate = (agent: Agent, code: string, subtotalCents = 2000) => agent.post('/api/coupons/validate').set(CSRF).send({ establishmentId: world.estA.id, code, subtotalCents });

    it('valida, aplica o desconto exato, e impede reuso pelo mesmo cliente (outro cliente pode usar)', async () => {
      expect((await coupon()).code).toBe('BEMVINDO10');
      const preview = await validate(client, 'bemvindo10');
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({ discountCents: 200 });

      const order = await place(client, { couponCode: 'bemvindo10', expectedTotalCents: 1800 });
      expect(order.status).toBe(201);
      expect(order.body).toMatchObject({ totalCents: 1800, couponCode: 'BEMVINDO10', couponDiscountCents: 200 });

      const again = await place(client, { couponCode: 'BEMVINDO10' });
      expect(again.status).toBe(422);
      expect(again.body.code).toBe('COUPON_ALREADY_USED');
      expect((await validate(client, 'BEMVINDO10')).body.code).toBe('COUPON_ALREADY_USED');

      expect((await place(other, { couponCode: 'BEMVINDO10' })).status).toBe(201);
    });

    it('cupom expirado, futuro, inexistente, inativo ou abaixo do mínimo é recusado com mensagem clara', async () => {
      await coupon({ code: 'VELHO', startsAt: new Date(Date.now() - 48 * HOUR).toISOString(), endsAt: new Date(Date.now() - 24 * HOUR).toISOString() });
      await coupon({ code: 'FUTURO', startsAt: new Date(Date.now() + 24 * HOUR).toISOString(), endsAt: new Date(Date.now() + 48 * HOUR).toISOString() });
      await coupon({ code: 'DESLIGADO', active: false });
      await coupon({ code: 'GRANDE', minOrderCents: 10_000 });
      const code = async (value: string) => (await validate(client, value)).body;
      expect(await code('VELHO')).toMatchObject({ code: 'COUPON_EXPIRED', message: 'Este cupom expirou.' });
      expect((await code('FUTURO')).code).toBe('COUPON_NOT_STARTED');
      expect((await code('DESLIGADO')).code).toBe('COUPON_INACTIVE');
      expect((await code('GRANDE')).code).toBe('COUPON_MIN_ORDER');
      expect((await code('NAOEXISTE')).code).toBe('COUPON_INVALID');
      expect((await place(client, { couponCode: 'VELHO' })).status).toBe(422);
    });

    it('limite de usos e cancelamento liberando o cupom', async () => {
      await coupon({ code: 'UNICO', maxUses: 1 });
      const first = (await place(client, { couponCode: 'UNICO' })).body;
      expect((await place(other, { couponCode: 'UNICO' })).body.code).toBe('COUPON_EXHAUSTED');
      expect((await client.post(`/api/orders/${first.id}/cancel`).set(CSRF)).status).toBe(200);
      expect((await place(other, { couponCode: 'UNICO' })).status).toBe(201);
    });

    it('cupom fixo nunca deixa o total abaixo do mínimo; código repetido é recusado', async () => {
      await coupon({ code: 'TUDO', discountType: 'fixed', discountValue: 999_999 });
      expect((await validate(client, 'TUDO')).body.discountCents).toBe(1900);
      const dup = await manager.post(`${est()}/coupons`).set(CSRF).send({ code: 'tudo', discountType: 'fixed', discountValue: 100, startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + HOUR).toISOString() });
      expect(dup.status).toBe(409);
    });

    it('cupom usado não é excluído; código é por estabelecimento (outra casa não enxerga)', async () => {
      const c = await coupon();
      await place(client, { couponCode: 'BEMVINDO10' });
      expect((await manager.delete(`${est()}/coupons/${c.id}`).set(CSRF)).status).toBe(409);
      const res = await client.post('/api/coupons/validate').set(CSRF).send({ establishmentId: world.estB.id, code: 'BEMVINDO10', subtotalCents: 1000 });
      expect(res.body.code).toBe('COUPON_INVALID');
    });
  });

  describe('métodos de pagamento salvos (49)', () => {
    const newCard = { kind: 'credit', number: '4242 4242 4242 4242', holderName: 'joao silva', expMonth: 12, expYear: new Date().getUTCFullYear() + 2, cvv: '123' };

    it('salva só bandeira, final e validade; o primeiro vira padrão e o número nunca é devolvido', async () => {
      const res = await client.post('/api/me/payment-methods').set(CSRF).send(newCard);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ brand: 'visa', last4: '4242', isDefault: true, expired: false, holderName: 'JOAO SILVA' });
      expect(JSON.stringify(res.body)).not.toContain('4242 4242');
      const row = await t.prisma.savedPaymentMethod.findFirstOrThrow();
      expect(JSON.stringify(row)).not.toMatch(/4242424242424242|123"/);
      expect((await client.get('/api/me/payment-methods')).body).toHaveLength(1);
    });

    it('valida número (Luhn), validade e duplicidade', async () => {
      expect((await client.post('/api/me/payment-methods').set(CSRF).send({ ...newCard, number: '4242424242424241' })).body.code).toBe('INVALID_CARD');
      expect((await client.post('/api/me/payment-methods').set(CSRF).send({ ...newCard, expYear: 2020 })).body.code).toBe('CARD_EXPIRED');
      expect((await client.post('/api/me/payment-methods').set(CSRF).send(newCard)).status).toBe(201);
      expect((await client.post('/api/me/payment-methods').set(CSRF).send(newCard)).body.code).toBe('PAYMENT_METHOD_EXISTS');
    });

    it('define padrão, remove (o padrão passa para outro) e isola por usuário', async () => {
      const a = (await client.post('/api/me/payment-methods').set(CSRF).send(newCard)).body;
      const b = (await client.post('/api/me/payment-methods').set(CSRF).send({ ...newCard, number: '5555555555554444', kind: 'debit' })).body;
      expect(b.isDefault).toBe(false);
      expect((await client.put(`/api/me/payment-methods/${b.id}/default`).set(CSRF)).body.isDefault).toBe(true);
      const list = (await client.get('/api/me/payment-methods')).body as { id: string; isDefault: boolean }[];
      expect(list.filter(m => m.isDefault)).toHaveLength(1);
      expect((await other.delete(`/api/me/payment-methods/${a.id}`).set(CSRF)).status).toBe(404);
      expect((await client.delete(`/api/me/payment-methods/${b.id}`).set(CSRF)).status).toBe(204);
      expect((await client.get('/api/me/payment-methods')).body[0]).toMatchObject({ id: a.id, isDefault: true });
    });

    it('paga com o cartão salvo sem enviar dados do cartão; tipo errado e cartão de outro usuário são recusados', async () => {
      const saved = (await client.post('/api/me/payment-methods').set(CSRF).send(newCard)).body;
      const order = (await place(client)).body;
      const res = await pay(client, order.id, { method: 'credit', savedMethodId: saved.id });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('paid');
      expect(gateway.created[0]?.cardToken).toMatch(/^vault_4242_/);
      expect(gateway.created[0]?.paymentMethodId).toBe('visa');

      const order2 = (await place(client)).body;
      expect((await pay(client, order2.id, { method: 'debit', savedMethodId: saved.id })).body.code).toBe('SAVED_METHOD_MISMATCH');
      const order3 = (await place(other)).body;
      expect((await pay(other, order3.id, { method: 'credit', savedMethodId: saved.id })).status).toBe(404);
      expect((await pay(client, order2.id, { method: 'pix', savedMethodId: saved.id })).status).toBe(400);
    });

    it('cartão vencido depois de salvo não paga', async () => {
      const saved = (await client.post('/api/me/payment-methods').set(CSRF).send(newCard)).body;
      await t.prisma.savedPaymentMethod.update({ where: { id: saved.id }, data: { expYear: 2020 } });
      const order = (await place(client)).body;
      expect((await pay(client, order.id, { method: 'credit', savedMethodId: saved.id })).body.code).toBe('CARD_EXPIRED');
      expect((await client.get('/api/me/payment-methods')).body[0].expired).toBe(true);
    });

    it('sem cofre no provedor, salvar cartão responde 503', async () => {
      Object.defineProperty(gateway, 'supportsCardVault', { value: false, configurable: true });
      try {
        expect((await client.post('/api/me/payment-methods').set(CSRF).send(newCard)).status).toBe(503);
      } finally {
        Object.defineProperty(gateway, 'supportsCardVault', { value: true, configurable: true });
      }
    });
  });

  describe('alergias e restrições (64)', () => {
    it('guarda múltiplas restrições no perfil e rejeita chaves desconhecidas', async () => {
      const res = await client.patch('/api/me').set(CSRF).send({ dietaryRestrictions: ['gluten', 'lactose', 'peanut'] });
      expect(res.status).toBe(200);
      expect(res.body.user.dietaryRestrictions).toEqual(['gluten', 'lactose', 'peanut']);
      expect((await client.get('/api/me')).body.user.dietaryRestrictions).toHaveLength(3);
      expect((await client.patch('/api/me').set(CSRF).send({ dietaryRestrictions: ['poeira'] })).status).toBe(400);
      expect((await client.patch('/api/me').set(CSRF).send({ dietaryRestrictions: [] })).body.user.dietaryRestrictions).toEqual([]);
    });

    it('gestor cadastra alérgenos do item e o cardápio público os expõe para o aviso', async () => {
      const upd = await manager.patch(`${est()}/menu/items/${world.itemA.id}`).set(CSRF).send({ allergens: ['gluten', 'alcohol'] });
      expect(upd.status).toBe(200);
      expect(upd.body.allergens).toEqual(['gluten', 'alcohol']);
      const menu = await client.get(`/api/restaurants/${world.estA.id}/menu`);
      const item = menu.body.items.find((i: { id: string }) => i.id === world.itemA.id);
      expect(item.allergens).toEqual(['gluten', 'alcohol']);
      expect(restrictedAllergens(item.allergens, ['gluten', 'peanut'])).toEqual(['gluten']);
      expect((await manager.patch(`${est()}/menu/items/${world.itemA.id}`).set(CSRF).send({ allergens: ['xyz'] })).status).toBe(400);
    });
  });

  describe('avaliações (48)', () => {
    it('só pedido entregue, uma vez por pedido, e a nota média muda na hora', async () => {
      const order = (await place(client)).body;
      expect((await client.post(`/api/orders/${order.id}/review`).set(CSRF).send({ rating: 5 })).body.code).toBe('ORDER_NOT_DELIVERED');
      await pay(client, order.id);
      await deliver(order.id);
      expect((await client.get(`/api/orders/${order.id}`)).body).toMatchObject({ canReview: true, reviewRating: null });

      const res = await client.post(`/api/orders/${order.id}/review`).set(CSRF).send({ rating: 4, comment: '  Muito bom!  ' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ rating: 4, comment: 'Muito bom!', authorName: 'Cliente' });
      expect((await client.post(`/api/orders/${order.id}/review`).set(CSRF).send({ rating: 1 })).body.code).toBe('ALREADY_REVIEWED');
      expect((await client.get(`/api/orders/${order.id}`)).body).toMatchObject({ canReview: false, reviewRating: 4 });

      const detail = await t.browser().get(`/api/restaurants/${world.estA.id}`);
      expect(detail.body).toMatchObject({ rating: 4, ratingCount: 1 });
      const reviews = await t.browser().get(`/api/restaurants/${world.estA.id}/reviews`);
      expect(reviews.body).toMatchObject({ average: 4, count: 1, distribution: { 4: 1, 5: 0 } });
      expect(reviews.body.items).toHaveLength(1);
    });

    it('média acumula várias notas (e o legado) sem erro de arredondamento; nota inválida e pedido alheio são recusados', async () => {
      await t.prisma.establishment.update({ where: { id: world.estA.id }, data: { ratingAverage: 4.5, ratingCount: 2, ratingSum: 9 } });
      const a = (await place(client)).body;
      await pay(client, a.id);
      await deliver(a.id);
      const b = (await place(other)).body;
      await pay(other, b.id);
      await deliver(b.id);
      expect((await client.post(`/api/orders/${a.id}/review`).set(CSRF).send({ rating: 6 })).status).toBe(400);
      expect((await client.post(`/api/orders/${b.id}/review`).set(CSRF).send({ rating: 5 })).status).toBe(404);
      await client.post(`/api/orders/${a.id}/review`).set(CSRF).send({ rating: 3 });
      await other.post(`/api/orders/${b.id}/review`).set(CSRF).send({ rating: 5 });
      // (9 + 3 + 5) / 4 = 4,25 → 4,3 (meio para cima)
      const detail = await t.browser().get(`/api/restaurants/${world.estA.id}`);
      expect(detail.body).toMatchObject({ rating: 4.3, ratingCount: 4 });
    });

    it('a entrega gera o pedido de avaliação in-app (e por e-mail), sem duplicar', async () => {
      const order = (await place(client)).body;
      await pay(client, order.id);
      await deliver(order.id);
      await new Promise(resolve => setTimeout(resolve, 300));
      const inbox = (await client.get('/api/me/notifications')).body;
      expect(inbox.items.filter((n: { kind: string }) => n.kind === 'review_request')).toHaveLength(1);
      expect(inbox.unread).toBeGreaterThanOrEqual(1);
      expect(t.email.messages.some(m => m.message.includes('Avalie'))).toBe(true);
      await client.post('/api/me/notifications/read').set(CSRF).send({});
      expect((await client.get('/api/me/notifications')).body.unread).toBe(0);
    });
  });

  describe('compartilhar restaurante (62)', () => {
    it('registra a origem do acesso (sem login) e o gestor vê por origem; origem desconhecida vira "other"', async () => {
      const visitor = t.browser();
      expect((await visitor.post(`/api/restaurants/${world.estA.id}/share-visits`).set(CSRF).send({ source: 'whatsapp' })).status).toBe(204);
      expect((await visitor.post(`/api/restaurants/${world.estA.id}/share-visits`).set(CSRF).send({ source: 'whatsapp' })).status).toBe(204);
      expect((await visitor.post(`/api/restaurants/${world.estA.id}/share-visits`).set(CSRF).send({})).status).toBe(204);
      expect((await visitor.post(`/api/restaurants/${world.estA.id}/share-visits`).set(CSRF).send({ source: 'tiktok' })).status).toBe(400);
      expect((await visitor.post(`/api/restaurants/5b0f1e0e-6d62-4f9a-9a58-0c5c5b0b9b11/share-visits`).set(CSRF).send({})).status).toBe(404);
      const summary = await manager.get(`${est()}/share-visits`);
      expect(summary.body).toEqual({ total: 3, bySource: [{ source: 'whatsapp', count: 2 }, { source: 'other', count: 1 }] });
      expect((await t.browser().get(`${est()}/share-visits`)).status).toBe(401);
    });
  });

  describe('reservas de mesa (30)', () => {
    // Daqui a 2 dias, às 20:00 em São Paulo (23:00Z).
    const slot = () => {
      const day = new Date(Date.now() + 2 * 24 * HOUR);
      day.setUTCHours(23, 0, 0, 0);
      return day;
    };
    const book = (agent: Agent, partySize: number, startsAt = slot()) => agent.post('/api/bookings').set(CSRF).send({ establishmentId: world.estA.id, startsAt: startsAt.toISOString(), partySize });

    it('confirma quando há mesa livre e aparece no perfil do cliente e no painel do gestor como "confirmed"', async () => {
      const res = await book(client, 3);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'confirmed', tableLabel: 'Mesa 1', partySize: 3, establishmentName: 'Bar A' });
      expect((await client.get('/api/me/bookings')).body[0]).toMatchObject({ id: res.body.id, status: 'confirmed' });
      const staff = (await manager.get(`${est()}/bookings`)).body;
      expect(staff).toHaveLength(1);
      expect(staff[0]).toMatchObject({ id: res.body.id, status: 'confirmed', customerName: 'Cliente' });
      expect((await attendant.get(`${est()}/bookings`)).status).toBe(200);
    });

    it('recusa automaticamente sem disponibilidade (mesa ocupada ou grupo grande) e notifica o cliente', async () => {
      expect((await book(client, 2)).body.status).toBe('confirmed');
      const busy = await book(other, 2);
      expect(busy.status).toBe(201);
      expect(busy.body).toMatchObject({ status: 'refused', tableLabel: null });
      expect(busy.body.refusalReason).toContain('Não há mesa livre');
      const big = await book(other, 9);
      expect(big.body).toMatchObject({ status: 'refused', refusalReason: 'Nenhuma mesa comporta 9 pessoas.' });

      const next = new Date(slot().getTime() + 90 * 60_000); // sem sobreposição: livre de novo
      expect((await book(other, 2, next)).body.status).toBe('confirmed');
    });

    it('notifica o cliente da confirmação (in-app e e-mail) e da recusa', async () => {
      await book(client, 2);
      const inbox = (await client.get('/api/me/notifications')).body.items;
      expect(inbox[0]).toMatchObject({ kind: 'booking_confirmed' });
      expect(inbox[0].body).toContain('2 pessoas');
      expect(t.email.messages.some(m => m.destination === 'cliente@test.dev')).toBe(true);
      await book(other, 2);
      expect((await other.get('/api/me/notifications')).body.items[0].kind).toBe('booking_refused');
    });

    it('duas reservas simultâneas para a única mesa: só uma confirma', async () => {
      const results = await Promise.all([book(client, 2), book(other, 2)]);
      expect(results.map(r => r.body.status).sort()).toEqual(['confirmed', 'refused']);
    });

    it('valida antecedência, horário quebrado, tamanho do grupo e sobreposição do mesmo cliente', async () => {
      expect((await book(client, 2, new Date(Date.now() + 10 * 60_000))).body.code).toBe('BOOKING_TOO_SOON');
      const odd = slot();
      odd.setUTCMinutes(10);
      expect((await book(client, 2, odd)).body.code).toBe('INVALID_BOOKING_TIME');
      expect((await book(client, 0)).status).toBe(400);
      expect((await book(client, 2, new Date(Date.now() + 90 * 24 * HOUR))).body.code).toBe('BOOKING_TOO_FAR');
      expect((await book(client, 2)).body.status).toBe('confirmed');
      expect((await book(client, 2)).body.code).toBe('BOOKING_OVERLAP');
    });

    it('recusa fora do horário de funcionamento', async () => {
      await t.prisma.openingHour.deleteMany({ where: { establishmentId: world.estA.id } });
      await t.prisma.openingHour.create({ data: { establishmentId: world.estA.id, weekday: slot().getUTCDay(), opensAt: 17 * 60, closesAt: 18 * 60 } });
      const res = await book(client, 2);
      expect(res.body).toMatchObject({ status: 'refused', refusalReason: 'O restaurante está fechado nesse horário.' });
    });

    it('horários do dia mostram disponibilidade e liberam a mesa quando o cliente cancela', async () => {
      const date = slot().toISOString().slice(0, 10);
      const open = (await t.browser().get(`/api/restaurants/${world.estA.id}/booking-slots?date=${date}&partySize=2`)).body;
      const at20 = open.slots.find((s: { label: string }) => s.label === '20:00');
      expect(at20).toMatchObject({ available: true });
      const booking = (await book(client, 2)).body;
      const taken = (await t.browser().get(`/api/restaurants/${world.estA.id}/booking-slots?date=${date}&partySize=2`)).body;
      expect(taken.slots.find((s: { label: string }) => s.label === '20:00').available).toBe(false);
      expect(taken.slots.find((s: { label: string }) => s.label === '23:00').available).toBe(true);
      expect((await other.post(`/api/bookings/${booking.id}/cancel`).set(CSRF)).status).toBe(404);
      expect((await client.post(`/api/bookings/${booking.id}/cancel`).set(CSRF)).body.status).toBe('cancelled');
      const freed = (await t.browser().get(`/api/restaurants/${world.estA.id}/booking-slots?date=${date}&partySize=2`)).body;
      expect(freed.slots.find((s: { label: string }) => s.label === '20:00').available).toBe(true);
    });

    it('a casa cancela (cliente é avisado) e marca como atendida; outras casas não enxergam', async () => {
      const booking = (await book(client, 2)).body;
      const foreign = await login(t.browser(), world.managerB.email);
      expect((await foreign.post(`/api/establishments/${world.estB.id}/bookings/${booking.id}/cancel`).set(CSRF)).status).toBe(404);
      expect((await manager.post(`${est()}/bookings/${booking.id}/cancel`).set(CSRF)).body.status).toBe('cancelled');
      expect((await manager.post(`${est()}/bookings/${booking.id}/cancel`).set(CSRF)).status).toBe(409);
      const kinds = (await client.get('/api/me/notifications')).body.items.map((n: { kind: string }) => n.kind);
      expect(kinds).toContain('booking_cancelled');

      const second = (await book(client, 2)).body;
      expect((await attendant.post(`${est()}/bookings/${second.id}/seat`).set(CSRF)).body.status).toBe('seated');
    });
  });

  describe('duplicar item do cardápio (67)', () => {
    const dup = (id: string, body: object = {}) => manager.post(`${est()}/menu/items/${id}/duplicate`).set(CSRF).send(body);

    it('copia nome, descrição, preço, categoria e alérgenos; nunca cria dois itens ativos iguais', async () => {
      await t.prisma.menuItem.update({ where: { id: world.itemA.id }, data: { description: 'Lupulada', allergens: ['gluten'] } });
      const first = await dup(world.itemA.id);
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ name: 'IPA (cópia)', description: 'Lupulada', priceCents: 2000, category: 'Cervejas', allergens: ['gluten'] });
      expect(first.body.id).not.toBe(world.itemA.id);
      expect((await dup(world.itemA.id)).body.name).toBe('IPA (cópia 2)');
      expect((await dup(world.itemA.id, { name: 'ipa' })).body.code).toBe('DUPLICATE_ITEM');
      const edited = await dup(world.itemA.id, { name: 'IPA 600ml', priceCents: 3200 });
      expect(edited.body).toMatchObject({ name: 'IPA 600ml', priceCents: 3200, description: 'Lupulada' });
      const create = await manager.post(`${est()}/menu/items`).set(CSRF).send({ name: 'ipa 600ml', categoryName: 'Cervejas', priceCents: 100 });
      expect(create.body.code).toBe('DUPLICATE_ITEM');
      // Excluído libera o nome.
      await manager.delete(`${est()}/menu/items/${edited.body.id}`).set(CSRF);
      expect((await dup(world.itemA.id, { name: 'IPA 600ml' })).status).toBe(201);
    });

    it('copia a foto enviada como arquivo próprio: excluir o original não apaga a cópia', async () => {
      const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#e8700a' } }).png().toBuffer();
      const upload = await manager.put(`${est()}/menu/items/${world.itemA.id}/photo`).set(CSRF).attach('file', png, { filename: 'a.png', contentType: 'image/png' });
      expect(upload.status).toBe(200);
      const copy = (await dup(world.itemA.id)).body;
      expect(copy.imageUrl).toBeTruthy();
      expect(copy.imageUrl).not.toBe(upload.body.imageUrl);
      const rows = await t.prisma.menuItem.findMany({ where: { id: { in: [world.itemA.id, copy.id] } }, select: { imageStorageKey: true } });
      expect(new Set(rows.map(r => r.imageStorageKey)).size).toBe(2);
    });

    it('exige permissão de edição e respeita o estabelecimento', async () => {
      expect((await attendant.post(`${est()}/menu/items/${world.itemA.id}/duplicate`).set(CSRF).send({})).status).toBe(403);
      expect((await dup(world.itemB.id)).status).toBe(404);
    });
  });
});
