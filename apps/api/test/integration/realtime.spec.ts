import { io, type Socket } from 'socket.io-client';
import { REALTIME_EVENTS } from '@filafacil/shared';
import { resetDatabase } from '../helpers/database.js';
import { createUser, createWorld, PASSWORD, type World } from '../helpers/fixtures.js';
import { createTestApp, CSRF, type TestApp } from '../helpers/test-app.js';

describe('Tempo real (WebSocket)', () => {
  let t: TestApp;
  let world: World;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
  });
  afterEach(() => sockets.splice(0).forEach(socket => socket.close()));

  /** Login real e o cookie de acesso no handshake, como faz o navegador. */
  async function connect(email?: string | null) {
    let cookie = '';
    if (email) {
      const response = await t.browser().post('/api/auth/login').set(CSRF).send({ email, password: PASSWORD });
      cookie = ([] as string[]).concat(response.headers['set-cookie'] ?? []).map(c => c.split(';')[0]).join('; ');
    }
    const socket = io(`http://localhost:${t.port}/realtime`, { path: '/api/socket.io', transports: ['websocket'], extraHeaders: { cookie } });
    sockets.push(socket);
    await new Promise<void>(resolve => socket.on('connect', () => resolve()));
    return { socket, cookie };
  }

  it('equipe assina a sala do próprio estabelecimento logo ao conectar e recebe os eventos', async () => {
    // A assinatura é enviada no mesmo instante da conexão (antes de a autenticação do handshake terminar).
    const { socket, cookie } = await connect(world.managerA.email);
    const ack = await socket.emitWithAck('subscribe', { establishmentId: world.estA.id });
    expect(ack).toEqual({ ok: true });

    const event = new Promise(resolve => socket.once(REALTIME_EVENTS.waitlistUpdated, resolve));
    const added = await t
      .browser()
      .post(`/api/establishments/${world.estA.id}/waitlist`)
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ name: 'Grupo', phone: '19988887777', partySize: 2 });
    expect(added.status).toBe(201);
    await expect(event).resolves.toEqual({ establishmentId: world.estA.id });
  });

  it('não deixa anônimo nem equipe de outra casa entrar na sala da equipe', async () => {
    const anonymous = await connect();
    expect(await anonymous.socket.emitWithAck('subscribe', { establishmentId: world.estA.id })).toEqual({ ok: false });
    const other = await connect(world.managerB.email);
    expect(await other.socket.emitWithAck('subscribe', { establishmentId: world.estA.id })).toEqual({ ok: false });
  });

  it('avisa a sessão aberta quando o usuário é suspenso', async () => {
    const { socket } = await connect(world.managerA.email);
    const revoked = new Promise(resolve => socket.once(REALTIME_EVENTS.sessionRevoked, resolve));
    const admin = t.browser();
    await admin.post('/api/auth/login').set(CSRF).send({ email: world.admin.email, password: PASSWORD });
    await admin.patch(`/api/admin/users/${world.managerA.id}/status`).set(CSRF).send({ status: 'suspended' });
    await expect(revoked).resolves.toEqual({ reason: 'suspended' });
  });

  describe('acesso da equipe é revalidado (ficha 36)', () => {
    const adminAgent = async () => {
      const admin = t.browser();
      await admin.post('/api/auth/login').set(CSRF).send({ email: world.admin.email, password: PASSWORD });
      return admin;
    };
    const waitlistEvent = (socket: Socket) => {
      const seen: unknown[] = [];
      socket.on(REALTIME_EVENTS.waitlistUpdated, payload => seen.push(payload));
      return seen;
    };
    const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    it('quem perdeu o vínculo sai da sala na hora e não consegue entrar de novo', async () => {
      const { socket } = await connect(world.managerA.email);
      const otherManager = await createUser(t.prisma, { name: 'Gestor A2', email: 'gestor.a2@test.dev', role: 'manager', establishmentIds: [world.estA.id] });
      const other = await connect(otherManager.email);
      expect(await socket.emitWithAck('subscribe', { establishmentId: world.estA.id })).toEqual({ ok: true });
      const seen = waitlistEvent(socket);

      const admin = await adminAgent();
      const update = await admin.patch(`/api/admin/users/${world.managerA.id}/access`).set(CSRF).send({ role: 'manager', permissions: ['waitlist.manage', 'tables.view'], establishmentIds: [world.estB.id] });
      expect(update.status).toBe(200);
      await pause(200);
      const control = new Promise(resolve => {
        void other.socket.emitWithAck('subscribe', { establishmentId: world.estA.id }).then(() => other.socket.once(REALTIME_EVENTS.waitlistUpdated, resolve));
      });
      await pause(100);
      const added = await t.browser().post(`/api/establishments/${world.estA.id}/waitlist`).set(CSRF).set('Cookie', other.cookie).send({ name: 'Grupo X', phone: '19988887777', partySize: 2 });
      expect(added.status).toBe(201);
      await control; // quem continua vinculado recebe
      await pause(200);
      expect(seen).toEqual([]); // quem perdeu o vínculo não
      expect(await socket.emitWithAck('subscribe', { establishmentId: world.estA.id })).toEqual({ ok: false });
      expect(await socket.emitWithAck('subscribe', { establishmentId: world.estB.id })).toEqual({ ok: true });
    });

    it('quem teve todas as permissões removidas não assina nem mantém a sala', async () => {
      const { socket } = await connect(world.attendantA.email);
      expect(await socket.emitWithAck('subscribe', { establishmentId: world.estA.id })).toEqual({ ok: true });
      await t.prisma.userPermission.deleteMany({ where: { userId: world.attendantA.id } });
      expect(await socket.emitWithAck('subscribe', { establishmentId: world.estA.id })).toEqual({ ok: false });
    });

    it('usuário suspenso (ou com sessão revogada) não assina mesmo com a conexão antiga', async () => {
      const { socket } = await connect(world.managerA.email);
      await t.prisma.user.update({ where: { id: world.managerA.id }, data: { status: 'suspended' } });
      expect(await socket.emitWithAck('subscribe', { establishmentId: world.estA.id })).toEqual({ ok: false });
      await t.prisma.user.update({ where: { id: world.managerA.id }, data: { status: 'active' } });
      await t.prisma.session.updateMany({ where: { userId: world.managerA.id }, data: { revokedAt: new Date() } });
      expect(await socket.emitWithAck('subscribe', { establishmentId: world.estA.id })).toEqual({ ok: false });
    });

    it('suspensão pelo admin derruba a conexão', async () => {
      const { socket } = await connect(world.managerA.email);
      await socket.emitWithAck('subscribe', { establishmentId: world.estA.id });
      const closed = new Promise(resolve => socket.once('disconnect', resolve));
      const admin = await adminAgent();
      await admin.patch(`/api/admin/users/${world.managerA.id}/status`).set(CSRF).send({ status: 'suspended' });
      await closed;
      expect(socket.connected).toBe(false);
    });
  });
});
