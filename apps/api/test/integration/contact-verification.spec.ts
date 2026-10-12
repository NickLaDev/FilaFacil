import { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_MS } from '../../src/modules/auth/otp.service.js';
import { resetDatabase } from '../helpers/database.js';
import { createUser, createWorld, login, type World } from '../helpers/fixtures.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

describe('Verificação de e-mail/telefone da conta logada (ficha 65)', () => {
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
    t.sms.messages.length = 0;
    client = await login(t.browser(), world.client.email);
  });

  const request = (agent: Agent, channel: 'email' | 'phone' = 'email') => agent.post('/api/auth/verify-contact').set(CSRF).send({ channel });
  const confirm = (agent: Agent, challengeId: string, code: string) => agent.post('/api/auth/verify-contact/confirm').set(CSRF).send({ challengeId, code });
  const state = () => t.prisma.user.findUniqueOrThrow({ where: { id: world.client.id }, select: { emailVerifiedAt: true, phoneVerifiedAt: true } });

  it('só um código correto marca o e-mail como verificado, e o status fica gravado', async () => {
    const challenge = await request(client);
    expect(challenge.status).toBe(201);
    expect(challenge.body.destinationMasked).not.toContain('cliente@test.dev');
    const code = t.email.lastCode('cliente@test.dev') as string;
    expect(code).toMatch(/^\d{6}$/);

    const wrong = await confirm(client, challenge.body.challengeId, code === '000000' ? '111111' : '000000');
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('OTP_INVALID');
    expect((await state()).emailVerifiedAt).toBeNull();

    const ok = await confirm(client, challenge.body.challengeId, code);
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ emailVerified: true, phoneVerified: false });
    expect((await state()).emailVerifiedAt).toBeInstanceOf(Date);
    expect((await client.get('/api/me')).body.user.emailVerified).toBe(true);

    // Código de uso único e contato já verificado.
    expect((await confirm(client, challenge.body.challengeId, code)).status).toBe(400);
    expect((await request(client)).status).toBe(409);
  });

  it('o destino é sempre o contato da conta (não vem da requisição) e o celular também funciona', async () => {
    // O destino não é um campo aceito: tentar escolher outro é recusado.
    expect((await client.post('/api/auth/verify-contact').set(CSRF).send({ channel: 'phone', destination: 'outro@x.com' })).status).toBe(400);
    expect(t.sms.messages).toHaveLength(0);
    const response = await request(client, 'phone');
    expect(response.status).toBe(201);
    const code = t.sms.lastCode('19999990000') as string;
    expect(code).toBeTruthy();
    expect(t.email.messages).toHaveLength(0);
    const ok = await confirm(client, response.body.challengeId, code);
    expect(ok.body.user).toMatchObject({ phoneVerified: true, emailVerified: false });
  });

  it('respeita o intervalo mínimo de reenvio', async () => {
    expect((await request(client)).status).toBe(201);
    const again = await request(client);
    expect(again.status).toBe(429);
    expect(again.body.code).toBe('OTP_COOLDOWN');
    // Passado o intervalo, um novo código é aceito.
    await t.prisma.otpChallenge.updateMany({ data: { createdAt: new Date(Date.now() - OTP_RESEND_COOLDOWN_MS - 1000) } });
    expect((await request(client)).status).toBe(201);
  });

  it('bloqueia depois de tentativas demais, mesmo com o código certo em seguida', async () => {
    const challenge = await request(client);
    const code = t.email.lastCode('cliente@test.dev') as string;
    const wrongCode = code === '123456' ? '654321' : '123456';
    let last = 0;
    for (let attempt = 0; attempt < OTP_MAX_ATTEMPTS; attempt++) last = (await confirm(client, challenge.body.challengeId, wrongCode)).status;
    expect(last).toBe(429);
    expect((await confirm(client, challenge.body.challengeId, code)).status).toBe(429);
    expect((await state()).emailVerifiedAt).toBeNull();
  });

  it('código expirado não vale', async () => {
    const challenge = await request(client);
    const code = t.email.lastCode('cliente@test.dev') as string;
    await t.prisma.otpChallenge.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await confirm(client, challenge.body.challengeId, code)).status).toBe(400);
    expect((await state()).emailVerifiedAt).toBeNull();
  });

  it('o desafio pertence a quem o pediu: outra conta não consegue confirmá-lo', async () => {
    const challenge = await request(client);
    const code = t.email.lastCode('cliente@test.dev') as string;
    await createUser(t.prisma, { name: 'Intruso', email: 'intruso@test.dev', role: 'client' });
    const intruder = await login(t.browser(), 'intruso@test.dev');
    expect((await confirm(intruder, challenge.body.challengeId, code)).status).toBe(400);
    expect(await t.prisma.user.count({ where: { emailVerifiedAt: { not: null } } })).toBe(0);
    // E o dono ainda consegue (a tentativa do intruso não consumiu o código).
    expect((await confirm(client, challenge.body.challengeId, code)).status).toBe(200);
  });

  it('propósitos não se misturam: código de login não verifica contato e vice-versa', async () => {
    const login_ = await t.browser().post('/api/auth/otp').set(CSRF).send({ channel: 'phone', destination: '19999990000' });
    expect(login_.status).toBe(201);
    const loginCode = t.sms.lastCode('19999990000') as string;
    expect((await confirm(client, login_.body.challengeId, loginCode)).status).toBe(400);
    expect((await state()).phoneVerifiedAt).toBeNull();

    const contact = await request(client);
    const code = t.email.lastCode('cliente@test.dev') as string;
    const asLogin = await t.browser().post('/api/auth/otp/verify').set(CSRF).send({ challengeId: contact.body.challengeId, code });
    expect(asLogin.status).toBe(400);
  });

  it('trocar o e-mail depois de pedir o código invalida o código', async () => {
    const challenge = await request(client);
    const code = t.email.lastCode('cliente@test.dev') as string;
    expect((await client.patch('/api/me').set(CSRF).send({ email: 'novo@test.dev' })).status).toBe(200);
    expect((await confirm(client, challenge.body.challengeId, code)).status).toBe(400);
    expect((await state()).emailVerifiedAt).toBeNull();
  });

  it('exige login e informa quando a conta não tem o contato pedido', async () => {
    expect((await request(t.browser())).status).toBe(401);
    await t.prisma.user.update({ where: { id: world.client.id }, data: { phone: null } });
    const response = await request(client, 'phone');
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('CONTACT_MISSING');
  });

  it('informa quais canais entregam códigos neste ambiente', async () => {
    const providers = await t.browser().get('/api/auth/providers');
    expect(providers.body.codeChannels).toEqual({ email: true, phone: true });
  });
});
