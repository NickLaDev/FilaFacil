import { resetDatabase } from '../helpers/database.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, placeOrder } from '../helpers/orders.js';
import { createTestApp, CSRF, type TestApp } from '../helpers/test-app.js';

/** Esta suíte liga o rate limit (desligado nas demais) e usa um único IP, como o Wi-Fi de um bar. */
describe('Rate limit com vários clientes atrás do mesmo IP', () => {
  let t: TestApp;
  let world: World;
  let extra: Awaited<ReturnType<typeof createOrdersWorld>>;
  let previous: string | undefined;

  beforeAll(() => {
    previous = process.env.THROTTLE_DISABLED;
    process.env.THROTTLE_DISABLED = 'false';
  });
  afterAll(() => {
    process.env.THROTTLE_DISABLED = previous;
  });
  // Uma aplicação nova por teste: o contador do rate limit fica em memória e os próprios logins dos testes contam por IP.
  beforeEach(async () => {
    t = await createTestApp();
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    extra = await createOrdersWorld(t.prisma, world);
  });
  afterEach(() => t.close());

  it('o limite das rotas de pedido é por usuário: um cliente esgotar o dele não bloqueia o vizinho de Wi-Fi', async () => {
    const a = await login(t.browser(), world.client.email);
    const b = await login(t.browser(), extra.otherClient.email);
    const created = await placeOrder(a, { establishmentId: world.estA.id, items: [{ menuItemId: world.itemA.id, quantity: 1 }] }, CSRF);

    const statuses: number[] = [];
    for (let call = 0; call < 61; call++) statuses.push((await a.post(`/api/orders/${created.body.id}/payments/sync`).set(CSRF)).status);
    expect(statuses.slice(0, 60).every(status => status === 200)).toBe(true);
    expect(statuses[60]).toBe(429);

    // Mesmo IP, outra conta: segue livre (404 = pedido de outra pessoa, não bloqueio).
    expect((await b.post(`/api/orders/${created.body.id}/payments/sync`).set(CSRF)).status).toBe(404);
    expect((await b.get('/api/orders')).status).toBe(200);
  });

  it('o uso normal de vários clientes no mesmo IP (Pix consultando a cada 4 s) não chega perto do limite', async () => {
    const users = [await login(t.browser(), world.client.email), await login(t.browser(), extra.otherClient.email)];
    for (const user of users) {
      for (let call = 0; call < 20; call++) expect((await user.get('/api/orders')).status).toBe(200);
    }
  });

  it('o webhook tolera rajadas legítimas do gateway sem devolver 429', async () => {
    const statuses = new Set<number>();
    for (let call = 0; call < 130; call++) {
      statuses.add((await t.browser().post('/api/payments/webhook?type=payment&data.id=1').set('x-signature', 'ts=1,v1=x').send({})).status);
    }
    expect([...statuses]).toEqual([401]);
  });

  it('a leitura pública do QR tolera vários clientes no mesmo IP', async () => {
    const statuses = new Set<number>();
    for (let call = 0; call < 120; call++) statuses.add((await t.browser().get('/api/restaurants/qr/BARA-1111')).status);
    expect([...statuses]).toEqual([200]);
  });

  it('login continua estrito por IP (sem sessão não há usuário para contar)', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      statuses.push((await t.browser().post('/api/auth/login').set(CSRF).send({ email: `ninguem${attempt}@test.dev`, password: 'Senha123' })).status);
    }
    expect(statuses.slice(0, 10).every(status => status === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('o envio de código de verificação segue estrito por usuário', async () => {
    const a = await login(t.browser(), world.client.email);
    const b = await login(t.browser(), extra.otherClient.email);
    const codes: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) codes.push((await a.post('/api/auth/verify-contact').set(CSRF).send({ channel: 'email' })).status);
    expect(codes.at(-1)).toBe(429);
    // O vizinho de Wi-Fi não é afetado pelo limite do primeiro.
    expect((await b.post('/api/auth/verify-contact').set(CSRF).send({ channel: 'email' })).status).toBe(201);
  });

  it('pedido de código de login e redefinição de senha: 5 por minuto por IP; reserva do cliente: 10 por usuário', async () => {
    const otp: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) otp.push((await t.browser().post('/api/auth/otp').set(CSRF).send({ channel: 'email', destination: 'cliente@test.dev' })).status);
    expect(otp.at(-1)).toBe(429);
    const reset: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) reset.push((await t.browser().post('/api/auth/password-reset').set(CSRF).send({ channel: 'email', destination: `x${attempt}@test.dev` })).status);
    expect(reset.at(-1)).toBe(429);

    const a = await login(t.browser(), world.client.email);
    const b = await login(t.browser(), extra.otherClient.email);
    const reserve = [];
    for (let attempt = 0; attempt < 11; attempt++) reserve.push((await a.post(`/api/restaurants/${world.estA.id}/reservation`).set(CSRF).send({ partySize: 2 })).status);
    expect(reserve.at(-1)).toBe(429);
    expect((await b.get(`/api/restaurants/${world.estA.id}/reservation`)).status).toBe(200);
  });
});
