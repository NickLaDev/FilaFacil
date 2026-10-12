import { resetDatabase } from '../helpers/database.js';
import { createWorld, login, PASSWORD, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, placeOrder, verifyEmail } from '../helpers/orders.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

describe('Exclusão de conta (ficha 53)', () => {
  let t: TestApp;
  let world: World;
  let client: Agent;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    t.email.messages.length = 0;
    await verifyEmail(t.prisma, world.client.id);
    client = await login(t.browser(), world.client.email);
  });

  const remove = (agent: Agent, body: object) => agent.delete('/api/me').set(CSRF).send(body);
  const stored = () => t.prisma.user.findUniqueOrThrow({ where: { id: world.client.id } });

  it('com a senha: anonimiza dados pessoais, remove vínculos, encerra sessões e envia e-mail de confirmação', async () => {
    const other = await login(t.browser(), world.client.email);
    await t.prisma.userAddress.create({ data: { userId: world.client.id, label: 'Casa', street: 'Rua A, 1', city: 'Campinas', isDefault: true } });
    await client.put(`/api/me/favorites/${world.estA.id}`).set(CSRF);
    await t.prisma.user.update({ where: { id: world.client.id }, data: { cpfHash: 'a'.repeat(64), cpfEncrypted: 'v1:x', cpfMasked: '***.***.***-25' } });

    await t.prisma.otpChallenge.create({ data: { channel: 'email', destination: 'cliente@test.dev', codeHash: 'f'.repeat(64), expiresAt: new Date(Date.now() + 60_000), ipAddress: '1.2.3.4' } });
    const response = await remove(client, { password: PASSWORD });
    expect(response.status).toBe(204);
    expect(await t.prisma.otpChallenge.count({ where: { destination: 'cliente@test.dev' } })).toBe(0);
    expect(await t.prisma.session.count({ where: { userId: world.client.id, OR: [{ revokedAt: null }, { userAgent: { not: null } }, { ipAddress: { not: null } }] } })).toBe(0);
    expect(([] as string[]).concat(response.headers['set-cookie'] ?? []).join(';')).toMatch(/Max-Age=0|Expires=/);

    const user = await stored();
    expect(user).toMatchObject({ name: 'Conta excluída', email: null, phone: null, passwordHash: null, cpfHash: null, cpfEncrypted: null, cpfMasked: null, marketingOptIn: false });
    expect(user.deletedAt).toBeInstanceOf(Date);
    expect(await t.prisma.userAddress.count({ where: { userId: world.client.id } })).toBe(0);
    expect(await t.prisma.favorite.count({ where: { userId: world.client.id } })).toBe(0);
    expect(await t.prisma.userPermission.count({ where: { userId: world.client.id } })).toBe(0);

    expect((await other.get('/api/me')).status).toBe(401);
    expect((await client.get('/api/me')).status).toBe(401);
    expect((await t.browser().post('/api/auth/login').set(CSRF).send({ email: 'cliente@test.dev', password: PASSWORD })).status).toBe(401);
    expect(t.email.messages.filter(message => message.destination === 'cliente@test.dev')).toHaveLength(1);
    expect(t.email.messages[0]?.message).toContain('excluída');
  });

  it('Pix pendente de pedido aguardando pagamento também bloqueia', async () => {
    const extra = await createOrdersWorld(t.prisma, world);
    const order = await placeOrder(client, { establishmentId: world.estA.id, tableId: extra.tableA.id, items: [{ menuItemId: world.itemA.id, quantity: 1 }] }, CSRF);
    await t.prisma.payment.create({ data: { orderId: order.body.id, attempt: 1, method: 'pix', status: 'pending', amountCents: 2000 } });
    expect((await remove(client, { password: PASSWORD })).body.code).toBe('ACTIVE_ORDERS');
  });

  it('exige nova autenticação: senha errada ou ausente não exclui', async () => {
    expect((await remove(client, {})).body.code).toBe('REAUTH_REQUIRED');
    const wrong = await remove(client, { password: 'Errada123' });
    expect(wrong.status).toBe(401);
    expect((await t.browser().delete('/api/me').set(CSRF).send({ password: PASSWORD })).status).toBe(401);
    expect((await stored()).deletedAt).toBeNull();
    expect((await client.get('/api/me')).status).toBe(200);
  });

  it('limita tentativas de senha errada', async () => {
    for (let i = 0; i < 5; i++) expect((await remove(client, { password: 'Errada123' })).status).toBe(401);
    expect((await remove(client, { password: PASSWORD })).status).toBe(429);
    expect((await stored()).deletedAt).toBeNull();
  });

  it('com código enviado ao contato verificado (conta sem senha); código errado ou de outra finalidade não vale', async () => {
    await t.prisma.user.update({ where: { id: world.client.id }, data: { passwordHash: null } });
    const challenge = await client.post('/api/me/delete-account/code').set(CSRF).send({ channel: 'email' });
    expect(challenge.status).toBe(201);
    const code = t.email.lastCode('cliente@test.dev') as string;
    expect((await remove(client, { challengeId: challenge.body.challengeId, code: code === '000000' ? '111111' : '000000' })).body.code).toBe('OTP_INVALID');
    expect((await stored()).deletedAt).toBeNull();

    // Código de verificação de contato não serve para excluir.
    await t.prisma.user.update({ where: { id: world.client.id }, data: { emailVerifiedAt: null } });
    expect((await client.post('/api/me/delete-account/code').set(CSRF).send({ channel: 'email' })).body.code).toBe('NO_VERIFIED_CONTACT');
    await verifyEmail(t.prisma, world.client.id);

    expect((await remove(client, { challengeId: challenge.body.challengeId, code })).status).toBe(204);
    expect((await stored()).deletedAt).toBeInstanceOf(Date);
    // Uso único.
    expect((await remove(client, { challengeId: challenge.body.challengeId, code })).status).toBe(401);
  });

  it('pedidos em andamento bloqueiam; pedidos concluídos permanecem sem identificação', async () => {
    const extra = await createOrdersWorld(t.prisma, world);
    const order = await placeOrder(client, { establishmentId: world.estA.id, tableId: extra.tableA.id, items: [{ menuItemId: world.itemA.id, quantity: 1 }] }, CSRF);
    await t.prisma.order.update({ where: { id: order.body.id }, data: { status: 'preparing' } });
    const blocked = await remove(client, { password: PASSWORD });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('ACTIVE_ORDERS');
    expect((await stored()).deletedAt).toBeNull();

    await t.prisma.order.update({ where: { id: order.body.id }, data: { status: 'delivered' } });
    expect((await remove(client, { password: PASSWORD })).status).toBe(204);
    const kept = await t.prisma.order.findUniqueOrThrow({ where: { id: order.body.id }, include: { user: true } });
    expect(kept.user).toMatchObject({ name: 'Conta excluída', email: null });
  });

  it('e-mail e CPF ficam livres para novo cadastro e contas da equipe não se autoexcluem', async () => {
    expect((await remove(client, { password: PASSWORD })).status).toBe(204);
    const again = await t.browser().post('/api/auth/register').set(CSRF).send({ name: 'Novo Cliente', cpf: '52998224725', email: 'cliente@test.dev', password: 'Senha1234', acceptTerms: true });
    expect(again.status).toBe(201);

    const manager = await login(t.browser(), world.managerA.email);
    const refused = await remove(manager, { password: PASSWORD });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('STAFF_ACCOUNT');
  });
});
