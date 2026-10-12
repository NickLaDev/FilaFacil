import { resetDatabase } from '../helpers/database.js';
import { createUser, createWorld, login, PASSWORD, type World } from '../helpers/fixtures.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';
import { VirtualAuthenticator } from '../helpers/virtual-authenticator.js';

describe('Login por biometria / WebAuthn (ficha 59)', () => {
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
    client = await login(t.browser(), world.client.email);
  });

  const registerOptions = (agent: Agent = client) => agent.post('/api/auth/webauthn/register/options').set(CSRF).send({ password: PASSWORD });
  const registerVerify = (agent: Agent, body: object) => agent.post('/api/auth/webauthn/register/verify').set(CSRF).send(body);
  const loginOptions = (agent: Agent = t.browser()) => agent.post('/api/auth/webauthn/login/options').set(CSRF).send({});
  const loginVerify = (agent: Agent, body: object) => agent.post('/api/auth/webauthn/login/verify').set(CSRF).send(body);

  async function enable(device = new VirtualAuthenticator(), name = 'iPhone de teste') {
    const { body } = await registerOptions();
    const verified = await registerVerify(client, { challengeId: body.challengeId, response: device.create(body.options), deviceName: name });
    expect(verified.status).toBe(201);
    return { device, passkey: verified.body };
  }

  async function biometricLogin(device: VirtualAuthenticator, overrides: Parameters<VirtualAuthenticator['get']>[1] = {}) {
    const agent = t.browser();
    const { body } = await loginOptions(agent);
    return { agent, response: await loginVerify(agent, { challengeId: body.challengeId, response: device.get(body.options, overrides) }) };
  }

  describe('ativar e desativar', () => {
    it('exige login, devolve opções de credencial descobrível com verificação de usuário e lista o aparelho', async () => {
      expect((await registerOptions(t.browser())).status).toBe(401);
      const { body } = await registerOptions();
      expect(body.options.rp).toMatchObject({ id: 'localhost' });
      expect(body.options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
      expect(body.options.attestation).toBe('none');
      expect(body.options.challenge.length).toBeGreaterThanOrEqual(16);

      const { passkey } = await enable();
      expect(passkey).toMatchObject({ deviceName: 'iPhone de teste', lastUsedAt: null });
      const list = (await client.get('/api/auth/webauthn/credentials')).body;
      expect(list).toHaveLength(1);
      expect(JSON.stringify(list)).not.toMatch(/publicKey|credentialId/);
      // A chave privada nunca existe no servidor: só a pública.
      const row = await t.prisma.passkey.findFirstOrThrow({ where: { userId: world.client.id } });
      expect(row.publicKey.length).toBeGreaterThan(30);
    });

    it('cadastrar exige a senha atual (sessão roubada não basta) e redefinir a senha remove as biometrias', async () => {
      expect((await client.post('/api/auth/webauthn/register/options').set(CSRF).send({})).status).toBe(401);
      expect((await client.post('/api/auth/webauthn/register/options').set(CSRF).send({ password: 'Errada123' })).status).toBe(401);
      await enable();
      expect(await t.prisma.passkey.count()).toBe(1);
      const challenge = await t.browser().post('/api/auth/password-reset').set(CSRF).send({ channel: 'email', destination: 'cliente@test.dev' });
      const code = t.email.lastCode('cliente@test.dev') as string;
      expect((await t.browser().post('/api/auth/password-reset/confirm').set(CSRF).send({ challengeId: challenge.body.challengeId, code, newPassword: 'NovaSenha456' })).status).toBe(204);
      expect(await t.prisma.passkey.count()).toBe(0);
    });

    describe('conta sem senha (celular/Google/Apple)', () => {
      const optionsWithCode = (agent: Agent, body: object) => agent.post('/api/auth/webauthn/register/options').set(CSRF).send(body);

      async function passwordless() {
        const user = await createUser(t.prisma, { name: 'Sem Senha', email: 'sem.senha@test.dev', role: 'client' });
        await t.prisma.user.update({ where: { id: user.id }, data: { passwordHash: null } });
        const agent = t.browser();
        const challenge = await agent.post('/api/auth/otp').set(CSRF).send({ channel: 'email', destination: 'sem.senha@test.dev' });
        const ok = await agent.post('/api/auth/otp/verify').set(CSRF).send({ challengeId: challenge.body.challengeId, code: t.email.lastCode('sem.senha@test.dev') });
        expect(ok.status).toBe(200);
        return { user, agent };
      }
      const requestCode = (agent: Agent) => agent.post('/api/auth/webauthn/register/code').set(CSRF).send({ channel: 'email' });

      it('sessão sozinha não basta: sem código recebe 400 REAUTH_REQUIRED e nenhuma opção é emitida', async () => {
        const { agent } = await passwordless();
        const response = await optionsWithCode(agent, {});
        expect(response.status).toBe(400);
        expect(response.body.code).toBe('REAUTH_REQUIRED');
        expect(await t.prisma.webAuthnChallenge.count()).toBe(0);
      });

      it('código enviado ao contato verificado libera o cadastro; é de uso único e só vale para este fim', async () => {
        const { agent } = await passwordless();
        const challenge = await requestCode(agent);
        expect(challenge.status).toBe(200);
        const code = t.email.lastCode('sem.senha@test.dev') as string;
        const wrong = await optionsWithCode(agent, { challengeId: challenge.body.challengeId, code: code === '000000' ? '111111' : '000000' });
        expect(wrong.status).toBe(400);
        // O desafio de login (outra finalidade) não serve.
        const loginChallenge = await t.browser().post('/api/auth/otp').set(CSRF).send({ channel: 'email', destination: 'sem.senha@test.dev' });
        const loginCode = t.email.lastCode('sem.senha@test.dev') as string;
        expect((await optionsWithCode(agent, { challengeId: loginChallenge.body.challengeId, code: loginCode })).status).toBe(400);

        await t.prisma.otpChallenge.updateMany({ data: { createdAt: new Date(Date.now() - 60_000) } });
        const second = await requestCode(agent);
        expect(second.status).toBe(200);
        const secondCode = t.email.lastCode('sem.senha@test.dev') as string;
        const ok = await optionsWithCode(agent, { challengeId: second.body.challengeId, code: secondCode });
        expect(ok.status).toBe(200);
        const device = new VirtualAuthenticator();
        expect((await registerVerify(agent, { challengeId: ok.body.challengeId, response: device.create(ok.body.options) })).status).toBe(201);
        expect((await optionsWithCode(agent, { challengeId: second.body.challengeId, code: secondCode })).status).toBe(400); // reuso
      });

      it('código de outra conta não serve, e contato não verificado não recebe código', async () => {
        const { agent } = await passwordless();
        const victim = await requestCode(agent);
        const code = t.email.lastCode('sem.senha@test.dev') as string;
        const other = await createUser(t.prisma, { name: 'Outra', email: 'outra@test.dev', role: 'client' });
        await t.prisma.user.update({ where: { id: other.id }, data: { passwordHash: null } });
        const otherAgent = t.browser();
        const c = await otherAgent.post('/api/auth/otp').set(CSRF).send({ channel: 'email', destination: 'outra@test.dev' });
        await otherAgent.post('/api/auth/otp/verify').set(CSRF).send({ challengeId: c.body.challengeId, code: t.email.lastCode('outra@test.dev') });
        expect((await optionsWithCode(otherAgent, { challengeId: victim.body.challengeId, code })).status).toBe(400);
        await t.prisma.user.update({ where: { id: other.id }, data: { emailVerifiedAt: null } });
        expect((await requestCode(otherAgent)).status).toBe(422);
      });
    });

    it('registro recusa desafio inválido, de outro usuário, expirado, já usado e origem errada', async () => {
      const device = new VirtualAuthenticator();
      const { body } = await registerOptions();
      const wrongOrigin = await registerVerify(client, { challengeId: body.challengeId, response: device.create(body.options, { origin: 'https://evil.example' }) });
      expect(wrongOrigin.status).toBe(400);
      expect(wrongOrigin.body.code).toBe('WEBAUTHN_FAILED');
      // O desafio é de uso único mesmo quando a verificação falha.
      expect((await registerVerify(client, { challengeId: body.challengeId, response: device.create(body.options) })).status).toBe(400);

      const fresh = (await registerOptions()).body;
      const attendant = await login(t.browser(), world.attendantA.email);
      expect((await registerVerify(attendant, { challengeId: fresh.challengeId, response: device.create(fresh.options) })).status).toBe(400);

      const expired = (await registerOptions()).body;
      await t.prisma.webAuthnChallenge.update({ where: { id: expired.challengeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await registerVerify(client, { challengeId: expired.challengeId, response: device.create(expired.options) })).status).toBe(400);

      const other = (await registerOptions()).body;
      expect((await registerVerify(client, { challengeId: other.challengeId, response: device.create({ ...other.options, challenge: 'AAAAAAAAAAAAAAAAAAAAAA' }) })).status).toBe(400);
      expect(await t.prisma.passkey.count()).toBe(0);
    });

    it('desativar remove só a credencial da própria conta e impede o login', async () => {
      const { device, passkey } = await enable();
      const attendant = await login(t.browser(), world.attendantA.email);
      expect((await attendant.delete(`/api/auth/webauthn/credentials/${passkey.id}`).set(CSRF)).status).toBe(404);
      expect((await client.delete(`/api/auth/webauthn/credentials/${passkey.id}`).set(CSRF)).status).toBe(204);
      expect((await client.get('/api/auth/webauthn/credentials')).body).toEqual([]);
      expect((await biometricLogin(device)).response.status).toBe(400);
    });

    it('não permite cadastrar a mesma credencial duas vezes', async () => {
      const { device } = await enable();
      const { body } = await registerOptions();
      const again = await registerVerify(client, { challengeId: body.challengeId, response: device.create(body.options) });
      expect([400, 409]).toContain(again.status);
      expect(await t.prisma.passkey.count()).toBe(1);
    });
  });

  describe('login', () => {
    it('abre sessão sem e-mail, celular ou senha e atualiza contador e último uso', async () => {
      const { device } = await enable();
      const { agent, response } = await biometricLogin(device);
      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe(world.client.id);
      expect((await agent.get('/api/me')).body.user.id).toBe(world.client.id);
      const row = await t.prisma.passkey.findFirstOrThrow({ where: { userId: world.client.id } });
      expect(row.counter).toBe(1n);
      expect(row.lastUsedAt).toBeInstanceOf(Date);
      expect((await biometricLogin(device)).response.status).toBe(200);
      expect((await t.prisma.passkey.findFirstOrThrow({ where: { userId: world.client.id } })).counter).toBe(2n);
    });

    it('o login tradicional continua funcionando', async () => {
      await enable();
      expect((await login(t.browser(), world.client.email).then(agent => agent.get('/api/me'))).status).toBe(200);
    });

    it('recusa assinatura de outra chave, origem errada, sem verificação do usuário e contador repetido', async () => {
      const { device } = await enable();
      expect((await biometricLogin(device, { key: VirtualAuthenticator.otherKey() })).response.status).toBe(400);
      expect((await biometricLogin(device, { origin: 'https://evil.example' })).response.status).toBe(400);
      expect((await biometricLogin(device, { userVerified: false })).response.status).toBe(400);
      expect((await biometricLogin(device)).response.status).toBe(200); // contador 4 (após os 3 usos acima)
      // Replay/clone: contador igual ou menor que o gravado é recusado.
      expect((await biometricLogin(device, { counter: 2 })).response.status).toBe(400);
    });

    it('desafio de uso único: a mesma asserção não abre outra sessão e desafio expirado é recusado', async () => {
      const { device } = await enable();
      const agent = t.browser();
      const { body } = await loginOptions(agent);
      const response = device.get(body.options);
      expect((await loginVerify(agent, { challengeId: body.challengeId, response })).status).toBe(200);
      const replay = await loginVerify(t.browser(), { challengeId: body.challengeId, response });
      expect(replay.status).toBe(400);
      expect(replay.body.code).toBe('WEBAUTHN_FAILED');

      const stale = (await loginOptions()).body;
      await t.prisma.webAuthnChallenge.update({ where: { id: stale.challengeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await loginVerify(t.browser(), { challengeId: stale.challengeId, response: device.get(stale.options) })).status).toBe(400);
    });

    it('desafio de cadastro não serve para login', async () => {
      const { device } = await enable();
      const { body } = await registerOptions();
      expect((await loginVerify(t.browser(), { challengeId: body.challengeId, response: device.get(body.options) })).status).toBe(400);
    });

    it('credencial desconhecida e corpo malformado são recusados; conta suspensa não entra', async () => {
      const { device } = await enable();
      const stranger = new VirtualAuthenticator();
      expect((await biometricLogin(stranger)).response.status).toBe(400);
      const agent = t.browser();
      const { body } = await loginOptions(agent);
      expect((await loginVerify(agent, { challengeId: body.challengeId, response: { id: 5 } })).status).toBe(400);
      expect((await loginVerify(agent, { challengeId: 'x', response: {} })).status).toBe(400);

      await t.prisma.user.update({ where: { id: world.client.id }, data: { status: 'suspended' } });
      const suspended = await biometricLogin(device);
      expect(suspended.response.status).toBe(403);
      expect(suspended.response.body.code).toBe('ACCOUNT_SUSPENDED');
    });
  });
});
