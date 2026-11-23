import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MonitoringService } from '../../src/modules/monitoring/monitoring.service.js';
import { SettingsService } from '../../src/modules/settings/settings.service.js';
import { resetDatabase } from '../helpers/database.js';
import { FakePaymentGateway } from '../helpers/fake-gateway.js';
import { createUser, createWorld, login, PASSWORD, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, placeOrder, seedOrder, verifyEmail } from '../helpers/orders.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Data civil de Brasília (mesma regra da API). */
const spDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

describe('Sprint 5 — plataforma (fichas 32, 35, 40, 41, 42, 43, 52)', () => {
  let t: TestApp;
  let gateway: FakePaymentGateway;
  let world: World;
  let admin: Agent;
  let manager: Agent;

  beforeAll(async () => {
    gateway = new FakePaymentGateway();
    t = await createTestApp(undefined, gateway);
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    await createOrdersWorld(t.prisma, world);
    t.app.get(SettingsService).invalidate();
    admin = await login(t.browser(), world.admin.email);
    manager = await login(t.browser(), world.managerA.email);
    gateway.reset();
    t.email.messages.length = 0;
  });

  const sell = (establishmentId: string, itemId: string, name: string, price: number, paidAt: Date, status: 'delivered' | 'cancelled' = 'delivered', userId = world.client.id) =>
    seedOrder(t.prisma, { userId, establishmentId, status, paidAt, items: [{ menuItemId: itemId, name, unitPriceCents: price }] });

  // ─── Ficha 42 ─────────────────────────────────────────────────────────────

  describe('auditoria (42)', () => {
    it('ação sensível gera registro imediato e imutável, consultável com filtro por usuário, ação e data', async () => {
      await admin.patch(`/api/admin/users/${world.attendantA.id}/status`).set(CSRF).send({ status: 'suspended' });
      await admin.put(`/api/admin/establishments/${world.estA.id}/plan`).set(CSRF).send({ planId: world.plans.start.id });
      const page = (await admin.get('/api/admin/audit')).body;
      expect(page.total).toBe(2);
      const suspended = page.items.find((i: { action: string }) => i.action === 'user.suspended');
      expect(suspended).toMatchObject({ actorName: 'Admin', actorId: world.admin.id, actionLabel: 'Usuário suspenso', targetType: 'user', targetId: world.attendantA.id });
      expect(suspended.ipAddress).toBeTruthy();
      expect((await admin.get('/api/admin/audit?action=establishment.plan_changed')).body.items[0].summary).toContain('plan');
      expect((await admin.get(`/api/admin/audit?actorId=${world.admin.id}`)).body.total).toBe(2);
      const today = spDate(new Date());
      expect((await admin.get(`/api/admin/audit?from=${today}&to=${today}`)).body.total).toBe(2);
      expect((await admin.get('/api/admin/audit?from=2020-01-01&to=2020-01-02')).body.total).toBe(0);
      const [row] = await t.prisma.auditLog.findMany();
      await expect(t.prisma.auditLog.update({ where: { id: row?.id as string }, data: { summary: 'x' } })).rejects.toThrow(/imutável/);
      await expect(t.prisma.auditLog.delete({ where: { id: row?.id as string } })).rejects.toThrow(/imutável/);
      expect((await admin.delete(`/api/admin/audit/${row?.id}`).set(CSRF)).status).toBe(404);
    });

    it('exclusão de conta (LGPD) gera auditoria sem dados pessoais e apaga o log de acessos do titular', async () => {
      const client = await login(t.browser(), world.client.email);
      expect(await t.prisma.accessLog.count({ where: { userId: world.client.id } })).toBe(1);
      expect((await client.delete('/api/me').set(CSRF).send({ password: PASSWORD })).status).toBe(204);
      const entry = (await admin.get('/api/admin/audit?action=user.deleted')).body.items[0];
      expect(entry).toMatchObject({ actorName: 'Titular da conta', targetId: world.client.id });
      expect(JSON.stringify(entry)).not.toContain('cliente@test.dev');
      expect(await t.prisma.accessLog.count({ where: { userId: world.client.id } })).toBe(0);
    });

    it('estorno e configuração também são auditados; só admin com permissão consulta', async () => {
      await verifyEmail(t.prisma, world.client.id);
      const client = await login(t.browser(), world.client.email);
      const order = (await placeOrder(client, { establishmentId: world.estA.id, items: [{ menuItemId: world.itemA.id, quantity: 1 }] }, CSRF)).body;
      await client.post(`/api/orders/${order.id}/payments`).set(CSRF).send({ method: 'credit', cardToken: 'tok_test_123456', paymentMethodId: 'visa' });
      expect((await client.post(`/api/orders/${order.id}/cancel`).set(CSRF)).status).toBe(200);
      const refunded = (await admin.get('/api/admin/audit?action=order.refunded')).body.items[0];
      expect(refunded).toMatchObject({ actorName: 'Cliente', targetId: order.id });
      expect((await manager.get('/api/admin/audit')).status).toBe(403);
    });
  });

  // ─── Ficha 43 ─────────────────────────────────────────────────────────────

  describe('configurações e flags (43)', () => {
    it('desligar uma flag muda o comportamento em menos de 1 minuto, sem deploy', async () => {
      await verifyEmail(t.prisma, world.client.id);
      const client = await login(t.browser(), world.client.email);
      const slot = new Date(Date.now() + 2 * DAY);
      slot.setUTCHours(23, 0, 0, 0);
      const book = () => client.post('/api/bookings').set(CSRF).send({ establishmentId: world.estA.id, startsAt: slot.toISOString(), partySize: 2 });

      expect((await t.browser().get('/api/platform/features')).body).toMatchObject({ bookings: true, reviews: true });
      const off = await admin.put('/api/admin/settings/features.bookings').set(CSRF).send({ value: false });
      expect(off.status).toBe(409); // crítica: pede confirmação com o impacto
      expect(off.body.code).toBe('CONFIRMATION_REQUIRED');
      expect((await admin.put('/api/admin/settings/features.bookings').set(CSRF).send({ value: false, confirm: true })).body).toMatchObject({ value: false, updatedByName: 'Admin' });
      const started = Date.now();
      const blocked = await book();
      expect(blocked.body.code).toBe('FEATURE_DISABLED');
      expect(Date.now() - started).toBeLessThan(60_000);
      expect((await t.browser().get('/api/platform/features')).body.bookings).toBe(false);
      await admin.put('/api/admin/settings/features.bookings').set(CSRF).send({ value: true, confirm: true });
      expect((await book()).body.status).toBe('confirmed');
    });

    it('parâmetro global altera a regra (tamanho máximo da reserva) e é validado nos limites', async () => {
      await verifyEmail(t.prisma, world.client.id);
      const client = await login(t.browser(), world.client.email);
      expect((await admin.put('/api/admin/settings/bookings.maxPartySize').set(CSRF).send({ value: 999 })).status).toBe(422);
      expect((await admin.put('/api/admin/settings/bookings.maxPartySize').set(CSRF).send({ value: 'muito' })).status).toBe(422);
      expect((await admin.put('/api/admin/settings/nao.existe').set(CSRF).send({ value: true })).status).toBe(404);
      await admin.put('/api/admin/settings/bookings.maxPartySize').set(CSRF).send({ value: 3 });
      const slot = new Date(Date.now() + 2 * DAY);
      slot.setUTCHours(23, 0, 0, 0);
      const res = await client.post('/api/bookings').set(CSRF).send({ establishmentId: world.estA.id, startsAt: slot.toISOString(), partySize: 4 });
      expect(res.body).toMatchObject({ code: 'INVALID_PARTY_SIZE', message: 'A reserva é para 1 a 3 pessoas.' });
    });

    it('mostra o impacto antes de salvar uma alteração crítica', async () => {
      await t.prisma.couponRedemption.deleteMany();
      await manager.post(`/api/establishments/${world.estA.id}/coupons`).set(CSRF).send({ code: 'TESTE10', discountType: 'percent', discountValue: 10, startsAt: new Date(Date.now() - HOUR).toISOString(), endsAt: new Date(Date.now() + DAY).toISOString() });
      const impact = await admin.post('/api/admin/settings/features.coupons/impact').set(CSRF).send({ value: false });
      expect(impact.body).toMatchObject({ critical: true, affected: 1 });
      expect(impact.body.message).toContain('1 cupom(ns) ativo(s)');
      const list = (await admin.get('/api/admin/settings')).body as { key: string; value: unknown }[];
      expect(list.find(item => item.key === 'features.coupons')?.value).toBe(true);
      expect((await manager.get('/api/admin/settings')).status).toBe(403);
      // A alteração fica na auditoria (antes/depois).
      await admin.put('/api/admin/settings/features.reviews').set(CSRF).send({ value: false });
      expect((await admin.get('/api/admin/audit?action=settings.updated')).body.items[0].details).toEqual({ key: 'features.reviews', before: true, after: false });
    });
  });

  // ─── Ficha 52 ─────────────────────────────────────────────────────────────

  describe('log de acesso e dispositivos (52)', () => {
    it('registra data, IP e dispositivo de cada login; aparelho novo gera registro imediato e aviso ao titular', async () => {
      const ua1 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
      const ua2 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
      const first = t.browser();
      await first.post('/api/auth/login').set(CSRF).set('User-Agent', ua1).send({ email: world.client.email, password: PASSWORD });
      await first.post('/api/auth/login').set(CSRF).set('User-Agent', ua1).send({ email: world.client.email, password: PASSWORD }); // mesmo aparelho (cookie)
      const other = t.browser();
      await other.post('/api/auth/login').set(CSRF).set('User-Agent', ua2).send({ email: world.client.email, password: PASSWORD });

      const access = (await admin.get(`/api/admin/users/${world.client.id}/access`)).body;
      expect(access.logins).toHaveLength(3);
      const [latest, second, oldest] = access.logins;
      expect(latest).toMatchObject({ deviceLabel: 'Safari · iPhone', method: 'password', newDevice: true, sessionActive: true });
      expect(second).toMatchObject({ deviceLabel: 'Chrome · Windows', newDevice: false });
      expect(oldest.newDevice).toBe(true); // primeiro aparelho da conta (sem aviso)
      expect(latest.ipAddress).toBeTruthy();
      const notices = await t.prisma.appNotification.findMany({ where: { userId: world.client.id, kind: 'new_device_login' } });
      expect(notices).toHaveLength(1);
      expect(notices[0]?.body).toContain('Safari · iPhone');
      const flagged = (await admin.get('/api/admin/access-logs?newDevice=true')).body;
      expect(flagged.items.some((row: { userId: string; deviceLabel: string }) => row.userId === world.client.id && row.deviceLabel === 'Safari · iPhone')).toBe(true);
      // O aparelho é identificado por cookie próprio (HttpOnly); o banco só guarda o hash.
      const row = await t.prisma.accessLog.findFirstOrThrow({ where: { userId: world.client.id } });
      expect(row.deviceHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('o admin encerra a sessão remotamente em um clique: o aparelho perde o acesso na hora', async () => {
      const client = await login(t.browser(), world.client.email);
      expect((await client.get('/api/me')).status).toBe(200);
      const { sessions } = (await admin.get(`/api/admin/users/${world.client.id}/access`)).body;
      const active = sessions.find((s: { active: boolean }) => s.active);
      expect((await admin.post(`/api/admin/sessions/${active.id}/revoke`).set(CSRF)).status).toBe(204);
      expect((await client.get('/api/me')).status).toBe(401);
      expect((await admin.get(`/api/admin/users/${world.client.id}/access`)).body.sessions[0].active).toBe(false);
      expect((await admin.get('/api/admin/audit?action=session.revoked')).body.total).toBe(1);
      const again = await login(t.browser(), world.client.email);
      expect((await admin.post(`/api/admin/users/${world.client.id}/sessions/revoke-all`).set(CSRF)).status).toBe(204);
      expect((await again.get('/api/me')).status).toBe(401);
      expect((await manager.get(`/api/admin/users/${world.client.id}/access`)).status).toBe(403);
    });
  });

  // ─── Ficha 40 ─────────────────────────────────────────────────────────────

  describe('integrações externas (40)', () => {
    let server: Server;
    let healthy = true;
    let url = '';
    beforeAll(async () => {
      server = createServer((_req, res) => {
        res.writeHead(healthy ? 200 : 503).end(healthy ? 'ok' : 'fora');
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/health`;
    });
    afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
    beforeEach(() => {
      healthy = true;
    });
    const create = async (body: object = {}) => (await admin.post('/api/admin/monitoring/integrations').set(CSRF).send({ establishmentId: world.estA.id, name: 'Gateway', kind: 'payment', healthUrl: url, ...body })).body as { id: string; deviceKey: string };

    it('teste manual: disponível; quando falha, vira "indisponível" e abre incidente na hora; histórico registra', async () => {
      const integration = await create();
      const ok = (await admin.post(`/api/admin/monitoring/integrations/${integration.id}/test`).set(CSRF)).body;
      expect(ok).toMatchObject({ status: 'online', enabled: true, kind: 'payment' });
      expect(ok.checks[0]).toMatchObject({ ok: true, trigger: 'manual' });
      healthy = false;
      const started = Date.now();
      const failed = (await admin.post(`/api/admin/monitoring/integrations/${integration.id}/test`).set(CSRF)).body;
      expect(failed.status).toBe('offline');
      expect(failed.checks[0]).toMatchObject({ ok: false, error: 'Resposta HTTP 503' });
      const overview = (await admin.get('/api/admin/monitoring')).body;
      expect(overview.activeIncidents[0]).toMatchObject({ cause: 'check_failed', integrationName: 'Gateway' });
      expect(Date.now() - started).toBeLessThan(60_000);
      healthy = true;
      expect((await admin.post(`/api/admin/monitoring/integrations/${integration.id}/test`).set(CSRF)).body.status).toBe('online');
      expect((await admin.get('/api/admin/monitoring')).body.activeIncidents).toHaveLength(0);
      expect((await admin.get('/api/admin/audit?action=integration.tested')).body.total).toBe(3);
    });

    it('o monitor testa a URL sozinho e abre incidente quando a integração cai', async () => {
      const integration = await create();
      const monitoring = t.app.get(MonitoringService);
      await monitoring.probeAll();
      expect((await admin.get(`/api/admin/monitoring/integrations/${integration.id}`)).body.status).toBe('online');
      healthy = false;
      await monitoring.probeAll();
      const detail = (await admin.get(`/api/admin/monitoring/integrations/${integration.id}`)).body;
      expect(detail.status).toBe('offline');
      expect(detail.checks[0]).toMatchObject({ ok: false, trigger: 'monitor' });
      expect((await admin.get('/api/admin/monitoring')).body.impactedEstablishments).toBe(1);
    });

    it('desativar por estabelecimento: para de monitorar e encerra o incidente; heartbeat não reabre', async () => {
      const integration = await create({ healthUrl: null, name: 'PDV' });
      await t.browser().post('/api/integrations/heartbeat').set('X-Integration-Key', integration.deviceKey).send({ status: 'error', message: 'caiu' });
      expect((await admin.get('/api/admin/monitoring')).body.activeIncidents).toHaveLength(1);
      const disabled = (await admin.patch(`/api/admin/monitoring/integrations/${integration.id}`).set(CSRF).send({ enabled: false })).body;
      expect(disabled).toMatchObject({ enabled: false, status: 'unknown' });
      expect((await admin.get('/api/admin/monitoring')).body.activeIncidents).toHaveLength(0);
      await t.browser().post('/api/integrations/heartbeat').set('X-Integration-Key', integration.deviceKey).send({ status: 'error' });
      expect((await admin.get('/api/admin/monitoring')).body.activeIncidents).toHaveLength(0);
      expect(await t.app.get(MonitoringService).checkOffline(new Date(Date.now() + 10 * 60_000))).toBe(0);
      expect((await admin.patch(`/api/admin/monitoring/integrations/${integration.id}`).set(CSRF).send({ enabled: true })).body.enabled).toBe(true);
    });

    it('o tempo sem sinal vem da configuração (ficha 43) e URLs inválidas são recusadas', async () => {
      const integration = await create({ healthUrl: null, name: 'PDV' });
      await t.browser().post('/api/integrations/heartbeat').set('X-Integration-Key', integration.deviceKey).send({});
      await admin.put('/api/admin/settings/integrations.offlineAfterSeconds').set(CSRF).send({ value: 50, confirm: true });
      t.app.get(SettingsService).invalidate();
      expect(await t.app.get(MonitoringService).checkOffline(new Date(Date.now() + 40_000))).toBe(0);
      expect(await t.app.get(MonitoringService).checkOffline(new Date(Date.now() + 55_000))).toBe(1);
      expect((await admin.post('/api/admin/monitoring/integrations').set(CSRF).send({ establishmentId: world.estA.id, name: 'X1', kind: 'pdv', healthUrl: 'ftp://exemplo' })).body.code).toBe('INVALID_HEALTH_URL');
    });
  });

  // ─── Fichas 32 e 41 ───────────────────────────────────────────────────────

  describe('painel multi-estabelecimento (32) e métricas (41)', () => {
    it('os números do painel batem com a soma dos estabelecimentos ativos e comparam com ontem', async () => {
      const now = new Date();
      await sell(world.estA.id, world.itemA.id, 'IPA', 2000, now);
      await sell(world.estA.id, world.itemA.id, 'IPA', 2000, now);
      await sell(world.estB.id, world.itemB.id, 'Pilsen', 1000, now);
      await sell(world.estA.id, world.itemA.id, 'IPA', 2000, now, 'cancelled'); // não conta
      await sell(world.estA.id, world.itemA.id, 'IPA', 2000, new Date(now.getTime() - DAY));
      // Casa suspensa fica fora dos totais.
      await t.prisma.establishment.update({ where: { id: world.estStart.id }, data: { status: 'suspended' } });

      const overview = (await admin.get('/api/admin/overview')).body;
      expect(overview.activeEstablishments).toBe(2);
      expect(overview.suspendedEstablishments).toBe(1);
      expect(overview.today).toMatchObject({ orders: 3, gmvCents: 5000 });
      expect(overview.yesterday).toMatchObject({ orders: 1, gmvCents: 2000 });
      const sum = overview.establishments.reduce((acc: number, row: { today: { gmvCents: number } }) => acc + row.today.gmvCents, 0);
      expect(sum).toBe(overview.today.gmvCents);
      expect(overview.establishments.find((row: { name: string }) => row.name === 'Bar A')).toMatchObject({ today: { orders: 2, gmvCents: 4000 }, yesterday: { orders: 1, gmvCents: 2000 }, organizationName: 'Grupo Teste' });
      expect(overview.today.activeUsers).toBeGreaterThanOrEqual(2); // admin e gestor entraram hoje
      expect(overview.activeUsers.some((user: { name: string }) => user.name === 'Admin')).toBe(true);
    });

    it('sinaliza estabelecimento com problema (incidente, fatura atrasada, pedidos pausados) no topo', async () => {
      await t.prisma.establishment.update({ where: { id: world.estB.id }, data: { ordersPaused: true } });
      await t.prisma.invoice.create({ data: { establishmentId: world.estB.id, period: '2026-01', planName: 'Business', amountCents: 79900, dueDate: new Date('2026-01-10'), status: 'overdue' } });
      const overview = (await admin.get('/api/admin/overview')).body;
      expect(overview.establishments[0]).toMatchObject({ name: 'Bar B', problems: ['overdue_invoice', 'orders_paused'] });
    });

    it('métricas por período: série diária, comparação com o período anterior e soma por estabelecimento', async () => {
      const base = new Date();
      base.setUTCHours(15, 0, 0, 0);
      const day = (offset: number) => new Date(base.getTime() + offset * DAY);
      await sell(world.estA.id, world.itemA.id, 'IPA', 2000, day(0));
      await sell(world.estB.id, world.itemB.id, 'Pilsen', 1000, day(-1));
      await sell(world.estB.id, world.itemB.id, 'Pilsen', 1000, day(-1));
      await sell(world.estA.id, world.itemA.id, 'IPA', 2000, day(-3)); // período anterior
      const to = spDate(day(0));
      const from = spDate(day(-2));
      const res = await admin.get(`/api/admin/metrics?from=${from}&to=${to}`);
      expect(res.status).toBe(200);
      const metrics = res.body;
      expect(metrics.current.series).toHaveLength(3);
      expect(metrics.current.totals).toMatchObject({ orders: 3, gmvCents: 4000 });
      expect(metrics.previous).toMatchObject({ from: spDate(day(-5)), to: spDate(day(-3)), totals: { orders: 1, gmvCents: 2000 } });
      expect(metrics.change).toMatchObject({ orders: 200, gmvCents: 100 });
      const sumOrders = metrics.byEstablishment.reduce((acc: number, row: { orders: number }) => acc + row.orders, 0);
      const sumGmv = metrics.byEstablishment.reduce((acc: number, row: { gmvCents: number }) => acc + row.gmvCents, 0);
      expect({ sumOrders, sumGmv }).toEqual({ sumOrders: 3, sumGmv: 4000 });
      expect(metrics.current.series.find((p: { date: string }) => p.date === spDate(day(-1)))).toMatchObject({ orders: 2, gmvCents: 2000 });
      // Filtrar outro período recalcula.
      const narrow = (await admin.get(`/api/admin/metrics?from=${to}&to=${to}`)).body;
      expect(narrow.current.totals).toMatchObject({ orders: 1, gmvCents: 2000 });
      expect((await admin.get(`/api/admin/metrics?from=${to}&to=${from}`)).body.code).toBe('INVALID_PERIOD');
    });

    it('exporta CSV e PDF; só a plataforma acessa', async () => {
      await sell(world.estA.id, world.itemA.id, 'IPA', 2000, new Date());
      const today = spDate(new Date());
      const csv = await admin.get(`/api/admin/metrics/export?from=${today}&to=${today}&format=csv`);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text).toContain('Pedidos;1;0;');
      expect(csv.text).toContain('Bar A;1;20,00');
      const pdf = await admin
        .get(`/api/admin/metrics/export?from=${today}&to=${today}&format=pdf`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect((await manager.get('/api/admin/overview')).status).toBe(403);
      expect((await manager.get(`/api/admin/metrics?from=${today}&to=${today}`)).status).toBe(403);
    });
  });

  // ─── Ficha 35 ─────────────────────────────────────────────────────────────

  describe('organizações (35)', () => {
    it('relatório consolidado correto com navegação para cada unidade', async () => {
      const now = new Date();
      await sell(world.estA.id, world.itemA.id, 'IPA', 2000, now);
      await sell(world.estB.id, world.itemB.id, 'Pilsen', 1000, now);
      const list = (await admin.get('/api/admin/organizations/overview')).body;
      expect(list[0]).toMatchObject({ name: 'Grupo Teste', units: 3, activeUnits: 3 });
      const detail = (await admin.get(`/api/admin/organizations/${world.organization.id}`)).body;
      expect(detail.establishments.map((unit: { name: string }) => unit.name)).toEqual(['Bar A', 'Bar B', 'Bar Start']);
      expect(detail.report.totals).toEqual({ orders: 2, gmvCents: 3000, averageTicketCents: 1500 });
      expect(detail.report.units.find((unit: { id: string }) => unit.id === world.estA.id)).toMatchObject({ orders: 1, gmvCents: 2000, averageTicketCents: 2000 });
      const sum = detail.report.units.reduce((acc: number, unit: { gmvCents: number }) => acc + unit.gmvCents, 0);
      expect(sum).toBe(detail.report.totals.gmvCents);
    });

    it('vincular uma unidade a outra rede move os números e o histórico registra', async () => {
      const other = await t.prisma.organization.create({ data: { name: 'Rede Nova' } });
      await sell(world.estB.id, world.itemB.id, 'Pilsen', 1000, new Date());
      const res = await admin.post(`/api/admin/organizations/${other.id}/establishments`).set(CSRF).send({ establishmentId: world.estB.id });
      expect(res.body.report.totals).toMatchObject({ orders: 1, gmvCents: 1000 });
      expect((await admin.get(`/api/admin/organizations/${world.organization.id}`)).body.units).toBe(2);
      expect((await admin.get(`/api/admin/establishment-changes?establishmentId=${world.estB.id}`)).body.items[0]).toMatchObject({ field: 'organization', oldValue: 'Grupo Teste', newValue: 'Rede Nova' });
      expect((await admin.get('/api/admin/audit?action=organization.establishment_linked')).body.total).toBe(1);
    });

    it('hierarquia de permissões: admin da rede acessa todas as unidades; viewer só o relatório; remover tira o acesso', async () => {
      const network = await createUser(t.prisma, { name: 'Gestora da rede', email: 'rede@test.dev', role: 'manager', establishmentIds: [world.estA.id] });
      const agent = await login(t.browser(), network.email);
      expect((await agent.get(`/api/establishments/${world.estB.id}/menu/items`)).status).toBe(403);
      expect((await admin.put(`/api/admin/organizations/${world.organization.id}/members/${network.id}`).set(CSRF).send({ role: 'admin' })).status).toBe(200);
      expect((await agent.get(`/api/establishments/${world.estB.id}/menu/items`)).status).toBe(200);
      expect((await agent.get('/api/me')).body.memberships).toHaveLength(3);
      expect((await agent.get('/api/organizations/mine')).body).toEqual([{ id: world.organization.id, name: 'Grupo Teste', role: 'admin' }]);
      expect((await agent.get(`/api/organizations/${world.organization.id}/report`)).status).toBe(200);

      // Nova unidade criada na rede já entra no acesso do admin da rede.
      const created = await admin.post('/api/admin/establishments').set(CSRF).send({ name: 'Bar Novo', type: 'bar', city: 'Campinas', address: 'Rua 1', latitude: -22.9, longitude: -47.06, organizationId: world.organization.id, planId: world.plans.business.id });
      expect((await agent.get(`/api/establishments/${created.body.id}/menu/items`)).status).toBe(200);

      await admin.put(`/api/admin/organizations/${world.organization.id}/members/${network.id}`).set(CSRF).send({ role: 'viewer' });
      expect((await agent.get(`/api/establishments/${world.estB.id}/menu/items`)).status).toBe(403);
      expect((await agent.get(`/api/establishments/${world.estA.id}/menu/items`)).status).toBe(200); // vínculo direto continua
      expect((await agent.get(`/api/organizations/${world.organization.id}/report`)).status).toBe(200);
      await admin.delete(`/api/admin/organizations/${world.organization.id}/members/${network.id}`).set(CSRF);
      expect((await agent.get(`/api/organizations/${world.organization.id}/report`)).status).toBe(403);

      // Papel de rede: só equipe; admin da rede só gestor.
      expect((await admin.put(`/api/admin/organizations/${world.organization.id}/members/${world.client.id}`).set(CSRF).send({ role: 'viewer' })).body.code).toBe('ROLE_NOT_ALLOWED');
      expect((await admin.put(`/api/admin/organizations/${world.organization.id}/members/${world.attendantA.id}`).set(CSRF).send({ role: 'admin' })).body.code).toBe('ROLE_NOT_ALLOWED');
    });
  });
});
