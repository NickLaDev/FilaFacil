import { resetDatabase } from '../helpers/database.js';
import { createWorld, login, OTHER_VALID_CPF, PASSWORD, VALID_CPF, type World } from '../helpers/fixtures.js';
import { createTestApp, CSRF, type TestApp } from '../helpers/test-app.js';

function refreshTokenFrom(setCookie: string[] | string | undefined) {
  const header = ([] as string[]).concat(setCookie ?? []).find(cookie => cookie.startsWith('ff_refresh='));
  return header?.split(';')[0]?.slice('ff_refresh='.length) ?? '';
}

describe('Autenticação (fichas 01 e 06)', () => {
  let t: TestApp;
  let world: World;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    t.sms.messages.length = 0;
  });

  const register = (body: Record<string, unknown>) =>
    t.browser().post('/api/auth/register').set(CSRF).send({ name: 'Maria Souza', acceptTerms: true, ...body });

  describe('cadastro por nome e CPF', () => {
    it('cria a conta, abre a sessão e guarda o CPF só protegido', async () => {
      const agent = t.browser();
      const response = await agent
        .post('/api/auth/register')
        .set(CSRF)
        .send({ name: 'Maria Souza', cpf: '529.982.247-25', email: 'Maria@Email.com', password: PASSWORD, acceptTerms: true });

      expect(response.status).toBe(201);
      expect(response.body.user).toMatchObject({ name: 'Maria Souza', email: 'maria@email.com', cpfMasked: '***.***.247-25', role: 'client' });
      expect(JSON.stringify(response.body)).not.toContain(VALID_CPF);
      expect(([] as string[]).concat(response.headers['set-cookie'] ?? []).join(';')).toMatch(/ff_access=.*HttpOnly/);

      const stored = await t.prisma.user.findUniqueOrThrow({ where: { email: 'maria@email.com' } });
      expect(stored.cpfHash).toMatch(/^[a-f0-9]{64}$/);
      expect(stored.cpfEncrypted).not.toContain(VALID_CPF);
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/);

      const me = await agent.get('/api/me');
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe('maria@email.com');
    });

    it('bloqueia CPF inválido', async () => {
      const response = await register({ cpf: '123.456.789-00', email: 'x@email.com', password: PASSWORD });
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('INVALID_CPF');
    });

    it('bloqueia CPF duplicado, mesmo com outra máscara', async () => {
      expect((await register({ cpf: VALID_CPF, phone: '19988887777' })).status).toBe(201);
      const duplicate = await register({ cpf: '529.982.247-25', email: 'outra@email.com', password: PASSWORD });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.code).toBe('CPF_ALREADY_REGISTERED');
    });

    it('bloqueia e-mail já usado e exige senha forte no cadastro por e-mail', async () => {
      const taken = await register({ cpf: OTHER_VALID_CPF, email: world.client.email, password: PASSWORD });
      expect(taken.status).toBe(409);
      expect(taken.body.code).toBe('EMAIL_IN_USE');
      const weak = await register({ cpf: OTHER_VALID_CPF, email: 'nova@email.com', password: 'abc' });
      expect(weak.status).toBe(400);
    });

    it('rejeita campos desconhecidos (whitelist do DTO)', async () => {
      const response = await register({ cpf: OTHER_VALID_CPF, phone: '19977776666', role: 'admin' });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('login por e-mail e senha', () => {
    it('entra com credenciais corretas', async () => {
      const response = await t.browser().post('/api/auth/login').set(CSRF).send({ email: 'CLIENTE@test.dev', password: PASSWORD });
      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe(world.client.id);
    });

    it('responde a mesma mensagem para senha errada e e-mail inexistente', async () => {
      const wrong = await t.browser().post('/api/auth/login').set(CSRF).send({ email: world.client.email, password: 'Errada123' });
      const missing = await t.browser().post('/api/auth/login').set(CSRF).send({ email: 'ninguem@test.dev', password: 'Errada123' });
      expect(wrong.status).toBe(401);
      expect(missing.status).toBe(401);
      expect(wrong.body).toEqual(missing.body);
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('limita tentativas erradas por conta', async () => {
      // Conta exclusiva deste teste: o limite fica em memória durante a vida da API.
      const email = world.managerB.email;
      for (let attempt = 0; attempt < 5; attempt++) {
        await t.browser().post('/api/auth/login').set(CSRF).send({ email, password: 'Errada123' });
      }
      const blocked = await t.browser().post('/api/auth/login').set(CSRF).send({ email, password: PASSWORD });
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('TOO_MANY_LOGIN_ATTEMPTS');
    });

    it('exige o header anti-CSRF em métodos que alteram estado', async () => {
      const response = await t.browser().post('/api/auth/login').send({ email: world.client.email, password: PASSWORD });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('CSRF_HEADER_MISSING');
    });
  });

  describe('sessão persistente', () => {
    it('renova a sessão com o refresh token (rotação)', async () => {
      const agent = await login(t.browser(), world.client.email);
      const before = await t.prisma.session.findFirstOrThrow({ where: { userId: world.client.id } });
      const refresh = await agent.post('/api/auth/refresh').set(CSRF);
      expect(refresh.status).toBe(204);
      const after = await t.prisma.session.findUniqueOrThrow({ where: { id: before.id } });
      expect(after.refreshTokenHash).not.toBe(before.refreshTokenHash);
      expect(after.previousRefreshTokenHash).toBe(before.refreshTokenHash);
      expect((await agent.get('/api/me')).status).toBe(200);
    });

    it('revoga a sessão quando um refresh token antigo é reutilizado fora da janela', async () => {
      const agent = t.browser();
      const loginResponse = await agent.post('/api/auth/login').set(CSRF).send({ email: world.client.email, password: PASSWORD });
      const firstToken = refreshTokenFrom(loginResponse.headers['set-cookie']);
      expect((await agent.post('/api/auth/refresh').set(CSRF)).status).toBe(204);

      // Dentro da janela de tolerância (abas concorrentes) o token anterior ainda é aceito…
      const concurrentTab = await t.browser().post('/api/auth/refresh').set(CSRF).set('Cookie', `ff_refresh=${firstToken}`);
      expect(concurrentTab.status).toBe(204);

      // …mas fora dela é tratado como roubo e derruba a sessão inteira.
      await t.prisma.session.updateMany({ where: { userId: world.client.id }, data: { rotatedAt: new Date(Date.now() - 60_000) } });
      const reuse = await t.browser().post('/api/auth/refresh').set(CSRF).set('Cookie', `ff_refresh=${firstToken}`);
      expect(reuse.status).toBe(401);
      expect(reuse.body.code).toBe('SESSION_REVOKED');
      expect((await agent.get('/api/me')).status).toBe(401);
    });

    it('logout revoga a sessão no banco', async () => {
      const agent = await login(t.browser(), world.client.email);
      expect((await agent.post('/api/auth/logout').set(CSRF)).status).toBe(204);
      const session = await t.prisma.session.findFirstOrThrow({ where: { userId: world.client.id } });
      expect(session.revokedAt).not.toBeNull();
      expect((await agent.get('/api/me')).status).toBe(401);
    });

    it('sessão revogada perde acesso mesmo com o access token ainda válido', async () => {
      const agent = await login(t.browser(), world.client.email);
      await t.prisma.session.updateMany({ where: { userId: world.client.id }, data: { revokedAt: new Date() } });
      const response = await agent.get('/api/me');
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('SESSION_EXPIRED');
    });
  });

  describe('usuário suspenso', () => {
    it('perde acesso imediatamente na sessão aberta e não consegue renovar nem logar', async () => {
      const manager = await login(t.browser(), world.managerA.email);
      expect((await manager.get(`/api/establishments/${world.estA.id}/menu/items`)).status).toBe(200);

      const admin = await login(t.browser(), world.admin.email);
      const suspend = await admin.patch(`/api/admin/users/${world.managerA.id}/status`).set(CSRF).send({ status: 'suspended' });
      expect(suspend.status).toBe(200);

      const blocked = await manager.get(`/api/establishments/${world.estA.id}/menu/items`);
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('ACCOUNT_SUSPENDED');
      expect((await manager.post('/api/auth/refresh').set(CSRF)).status).toBe(403);
      const relogin = await t.browser().post('/api/auth/login').set(CSRF).send({ email: world.managerA.email, password: PASSWORD });
      expect(relogin.status).toBe(403);
      expect(await t.prisma.session.count({ where: { userId: world.managerA.id, revokedAt: null } })).toBe(0);
    });
  });

  describe('login por celular (código)', () => {
    const phone = '19999990000';

    it('envia o código, valida e marca o celular como verificado', async () => {
      const agent = t.browser();
      const challenge = await agent.post('/api/auth/otp').set(CSRF).send({ channel: 'phone', destination: '(19) 99999-0000' });
      expect(challenge.status).toBe(201);
      expect(challenge.body.destinationMasked).toBe('(19) *****-0000');
      const code = t.sms.lastCode(phone);
      expect(code).toMatch(/^\d{6}$/);
      const stored = await t.prisma.otpChallenge.findUniqueOrThrow({ where: { id: challenge.body.challengeId } });
      expect(stored.codeHash).not.toContain(code);

      const wrong = await agent.post('/api/auth/otp/verify').set(CSRF).send({ challengeId: challenge.body.challengeId, code: code === '000000' ? '111111' : '000000' });
      expect(wrong.status).toBe(400);
      expect(wrong.body.code).toBe('OTP_INVALID');

      const ok = await agent.post('/api/auth/otp/verify').set(CSRF).send({ challengeId: challenge.body.challengeId, code });
      expect(ok.status).toBe(200);
      expect(ok.body.user).toMatchObject({ id: world.client.id, phoneVerified: true });

      const reused = await t.browser().post('/api/auth/otp/verify').set(CSRF).send({ challengeId: challenge.body.challengeId, code });
      expect(reused.status).toBe(400);
    });

    it('bloqueia após o número máximo de tentativas e respeita o intervalo de reenvio', async () => {
      const challenge = await t.browser().post('/api/auth/otp').set(CSRF).send({ channel: 'phone', destination: phone });
      const code = t.sms.lastCode(phone) as string;
      const wrongCode = code === '000000' ? '111111' : '000000';
      for (let attempt = 0; attempt < 4; attempt++) {
        await t.browser().post('/api/auth/otp/verify').set(CSRF).send({ challengeId: challenge.body.challengeId, code: wrongCode });
      }
      const fifth = await t.browser().post('/api/auth/otp/verify').set(CSRF).send({ challengeId: challenge.body.challengeId, code: wrongCode });
      expect(fifth.status).toBe(429);
      const afterLimit = await t.browser().post('/api/auth/otp/verify').set(CSRF).send({ challengeId: challenge.body.challengeId, code });
      expect(afterLimit.status).toBe(429);

      const resend = await t.browser().post('/api/auth/otp').set(CSRF).send({ channel: 'phone', destination: phone });
      expect(resend.status).toBe(429);
      expect(resend.body.code).toBe('OTP_COOLDOWN');
    });

    it('informa quando não há conta com o celular', async () => {
      const response = await t.browser().post('/api/auth/otp').set(CSRF).send({ channel: 'phone', destination: '11911112222' });
      expect(response.status).toBe(404);
      expect(t.sms.messages).toHaveLength(0);
    });
  });

  describe('Google e Apple', () => {
    it('informa provedores não configurados em vez de simular login', async () => {
      expect((await t.browser().get('/api/auth/providers')).body).toEqual({ google: false, apple: false, codeChannels: { email: true, phone: true }, paymentProvider: 'none' });
      const start = await t.browser().get('/api/auth/oauth/google');
      expect(start.status).toBe(503);
      expect(start.body.code).toBe('PROVIDER_NOT_CONFIGURED');
    });
  });

});
