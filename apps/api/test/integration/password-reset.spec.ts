import { OTP_MAX_ATTEMPTS, OTP_TTL_MS } from '../../src/modules/auth/otp.service.js';
import { resetDatabase } from '../helpers/database.js';
import { createWorld, login, PASSWORD, type World } from '../helpers/fixtures.js';
import { createTestApp, CSRF, type TestApp } from '../helpers/test-app.js';

describe('Recuperação de senha (ficha 44)', () => {
  let t: TestApp;
  let world: World;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    t.email.messages.length = 0;
    t.sms.messages.length = 0;
  });

  const NEW_PASSWORD = 'NovaSenha456';
  const request = (destination: string, channel: 'email' | 'phone' = 'email') =>
    t.browser().post('/api/auth/password-reset').set(CSRF).send({ channel, destination });
  const confirm = (challengeId: string, code: string, newPassword = NEW_PASSWORD) =>
    t.browser().post('/api/auth/password-reset/confirm').set(CSRF).send({ challengeId, code, newPassword });
  const loginStatus = (email: string, password: string) => t.browser().post('/api/auth/login').set(CSRF).send({ email, password }).then(r => r.status);

  it('código por e-mail troca a senha, o login com a nova funciona na hora e a antiga deixa de valer', async () => {
    const challenge = await request('cliente@test.dev');
    expect(challenge.status).toBe(200);
    const code = t.email.lastCode('cliente@test.dev') as string;
    // O prazo do código é de 10 min (dentro dos 30 da ficha).
    expect(new Date(challenge.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
    expect(OTP_TTL_MS).toBeLessThanOrEqual(30 * 60 * 1000);

    expect((await confirm(challenge.body.challengeId, code)).status).toBe(204);
    expect(await loginStatus('cliente@test.dev', NEW_PASSWORD)).toBe(200);
    expect(await loginStatus('cliente@test.dev', PASSWORD)).toBe(401);
    const stored = await t.prisma.user.findUniqueOrThrow({ where: { id: world.client.id } });
    expect(stored.passwordHash).not.toContain(NEW_PASSWORD);
    expect(stored.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('por celular também funciona', async () => {
    const challenge = await request('(19) 99999-0000', 'phone');
    expect(challenge.status).toBe(200);
    const code = t.sms.lastCode('19999990000') as string;
    expect((await confirm(challenge.body.challengeId, code)).status).toBe(204);
    expect(await loginStatus('cliente@test.dev', NEW_PASSWORD)).toBe(200);
  });

  it('o código é de uso único', async () => {
    const challenge = await request('cliente@test.dev');
    const code = t.email.lastCode('cliente@test.dev') as string;
    expect((await confirm(challenge.body.challengeId, code)).status).toBe(204);
    const again = await confirm(challenge.body.challengeId, code, 'OutraSenha789');
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('OTP_INVALID');
    expect(await loginStatus('cliente@test.dev', 'OutraSenha789')).toBe(401);
  });

  it('código expirado é recusado', async () => {
    const challenge = await request('cliente@test.dev');
    const code = t.email.lastCode('cliente@test.dev') as string;
    await t.prisma.otpChallenge.update({ where: { id: challenge.body.challengeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await confirm(challenge.body.challengeId, code)).body.code).toBe('OTP_INVALID');
    expect(await loginStatus('cliente@test.dev', PASSWORD)).toBe(200);
  });

  it('código errado conta tentativa e bloqueia após o limite; senha fraca não consome o código', async () => {
    const challenge = await request('cliente@test.dev');
    const code = t.email.lastCode('cliente@test.dev') as string;
    const weak = await confirm(challenge.body.challengeId, code, 'curta');
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('VALIDATION_FAILED');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i++) expect((await confirm(challenge.body.challengeId, wrong)).body.code).toBe('OTP_INVALID');
    expect((await confirm(challenge.body.challengeId, wrong)).body.code).toBe('OTP_TOO_MANY_ATTEMPTS');
    expect((await confirm(challenge.body.challengeId, code)).status).toBe(429);
  });

  it('não revela se a conta existe: mesma resposta, sem e-mail enviado, e o código falso nunca confirma', async () => {
    const real = await request('cliente@test.dev');
    const ghost = await request('ninguem@test.dev');
    expect(ghost.status).toBe(real.status);
    expect(Object.keys(ghost.body).sort()).toEqual(Object.keys(real.body).sort());
    expect(t.email.messages.filter(message => message.destination === 'ninguem@test.dev')).toHaveLength(0);
    expect((await confirm(ghost.body.challengeId, '123456')).body.code).toBe('OTP_INVALID');
    // Repetir o pedido logo em seguida (cooldown) também mantém a resposta uniforme.
    expect((await request('cliente@test.dev')).status).toBe(200);
    expect((await request('ninguem@test.dev')).status).toBe(200);
  });

  it('código de login não consome o limite do reset, e reenvio em cooldown devolve o mesmo desafio válido', async () => {
    await t.browser().post('/api/auth/otp').set(CSRF).send({ channel: 'email', destination: 'cliente@test.dev' });
    const first = await request('cliente@test.dev');
    const code = t.email.lastCode('cliente@test.dev') as string;
    expect(t.email.messages.at(-1)?.message).toContain('redefinir');
    const again = await request('cliente@test.dev');
    expect(again.body.challengeId).toBe(first.body.challengeId);
    expect((await confirm(again.body.challengeId, code)).status).toBe(204);
    // Contas inexistentes também mantêm um id estável dentro da janela.
    const ghost1 = await request('ninguem@test.dev');
    const ghost2 = await request('ninguem@test.dev');
    expect(ghost2.body.challengeId).toBe(ghost1.body.challengeId);
  });

  it('contas suspensas não recebem código; dados inválidos retornam 400', async () => {
    await t.prisma.user.update({ where: { id: world.client.id }, data: { status: 'suspended' } });
    expect((await request('cliente@test.dev')).status).toBe(200);
    expect(t.email.messages).toHaveLength(0);
    expect((await request('não-é-email')).status).toBe(400);
  });

  it('código de login ou de verificação não serve para redefinir senha', async () => {
    const otp = await t.browser().post('/api/auth/otp').set(CSRF).send({ channel: 'email', destination: 'cliente@test.dev' });
    const code = t.email.lastCode('cliente@test.dev') as string;
    expect((await confirm(otp.body.challengeId, code)).body.code).toBe('OTP_INVALID');
  });

  it('a redefinição encerra todas as sessões abertas', async () => {
    const device = await login(t.browser(), world.client.email);
    expect((await device.get('/api/me')).status).toBe(200);
    const challenge = await request('cliente@test.dev');
    await confirm(challenge.body.challengeId, t.email.lastCode('cliente@test.dev') as string);
    expect((await device.get('/api/me')).status).toBe(401);
  });

  it('um novo pedido invalida o código anterior ao confirmar o novo', async () => {
    const first = await request('cliente@test.dev');
    const firstCode = t.email.lastCode('cliente@test.dev') as string;
    await t.prisma.otpChallenge.update({ where: { id: first.body.challengeId }, data: { createdAt: new Date(Date.now() - 120_000) } });
    const second = await request('cliente@test.dev');
    const secondCode = t.email.lastCode('cliente@test.dev') as string;
    expect((await confirm(second.body.challengeId, secondCode)).status).toBe(204);
    expect((await confirm(first.body.challengeId, firstCode, 'Terceira789')).body.code).toBe('OTP_INVALID');
  });
});
