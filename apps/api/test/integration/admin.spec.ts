import { resetDatabase } from '../helpers/database.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createTestApp, CSRF, type TestApp } from '../helpers/test-app.js';

type Agent = Awaited<ReturnType<typeof login>>;

const CAMPINAS = 'lat=-22.9056&lng=-47.0608';

describe('Administração da plataforma (fichas 11, 34, 36, 37)', () => {
  let t: TestApp;
  let world: World;
  let admin: Agent;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    admin = await login(t.browser(), world.admin.email);
  });

  const searchNames = async (query = CAMPINAS) =>
    ((await t.browser().get(`/api/restaurants?${query}`)).body.items as { name: string }[]).map(item => item.name);

  describe('estabelecimentos', () => {
    it('busca ordena por distância e mostra o status de pedidos', async () => {
      const response = await t.browser().get(`/api/restaurants?${CAMPINAS}`);
      expect(response.status).toBe(200);
      expect(response.body.items.map((item: { name: string }) => item.name)).toEqual(['Bar A', 'Bar B', 'Bar Start']);
      expect(response.body.items[0]).toMatchObject({ isOpenNow: true, acceptingOrders: true, orderingStatus: 'open' });
      expect(response.body.items[0].distanceM).toBeLessThan(response.body.items[1].distanceM);
    });

    it('estabelecimento desativado some da busca, da página e do cardápio do cliente', async () => {
      const deactivated = await admin.patch(`/api/admin/establishments/${world.estA.id}/status`).set(CSRF).send({ status: 'inactive' });
      expect(deactivated.status).toBe(200);
      expect(await searchNames()).not.toContain('Bar A');
      expect((await t.browser().get(`/api/restaurants/${world.estA.id}`)).status).toBe(404);
      expect((await t.browser().get(`/api/restaurants/${world.estA.id}/menu`)).status).toBe(404);

      await admin.patch(`/api/admin/establishments/${world.estA.id}/status`).set(CSRF).send({ status: 'active' });
      expect(await searchNames()).toContain('Bar A');
    });

    it('novo estabelecimento aparece para o cliente quando atende aos critérios da busca', async () => {
      const created = await admin.post('/api/admin/establishments').set(CSRF).send({
        name: 'Bar Novo',
        type: 'bar',
        city: 'Campinas',
        address: 'Rua Nova, 10',
        latitude: -22.9,
        longitude: -47.06,
        organizationId: world.organization.id,
        planId: world.plans.business.id,
        openingHours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, opensAt: '00:00', closesAt: '24:00' })),
      });
      expect(created.status).toBe(201);
      expect(await searchNames()).toContain('Bar Novo');
      expect(await searchNames('lat=-23.5614&lng=-46.6559&radiusKm=5')).not.toContain('Bar Novo');
    });

    it('lista com paginação, busca e contagem por status', async () => {
      await admin.patch(`/api/admin/establishments/${world.estB.id}/status`).set(CSRF).send({ status: 'suspended' });
      const page = await admin.get('/api/admin/establishments?pageSize=2&page=1');
      expect(page.body).toMatchObject({ total: 3, pageSize: 2, counts: { all: 3, active: 2, suspended: 1, inactive: 0 } });
      expect(page.body.items).toHaveLength(2);
      const filtered = await admin.get('/api/admin/establishments?status=suspended');
      expect(filtered.body.items.map((item: { name: string }) => item.name)).toEqual(['Bar B']);
    });
  });

  describe('planos de assinatura', () => {
    it('trocar o plano libera/bloqueia recursos na hora, para a equipe e para o cliente', async () => {
      const manager = await login(t.browser(), world.managerA.email);
      const now = Date.now();
      const promo = await manager.post(`/api/establishments/${world.estA.id}/promotions`).set(CSRF).send({
        name: 'Promo', discountPercent: 50, itemIds: [world.itemA.id], startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 60_000 * 60).toISOString(),
      });
      expect(promo.status).toBe(201);
      const finalPrice = async () => (await t.browser().get(`/api/restaurants/${world.estA.id}/menu`)).body.items[0].finalPriceCents;
      expect(await finalPrice()).toBe(1000);

      await admin.put(`/api/admin/establishments/${world.estA.id}/plan`).set(CSRF).send({ planId: world.plans.start.id });
      const blocked = await manager.get(`/api/establishments/${world.estA.id}/promotions`);
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('FEATURE_NOT_IN_PLAN');
      expect(await finalPrice()).toBe(2000);
      expect((await manager.get(`/api/establishments/${world.estA.id}/plan`)).body.features).toEqual(['floor_plan', 'waitlist']);

      await admin.put(`/api/admin/establishments/${world.estA.id}/plan`).set(CSRF).send({ planId: world.plans.business.id });
      expect((await manager.get(`/api/establishments/${world.estA.id}/promotions`)).status).toBe(200);
      expect(await finalPrice()).toBe(1000);
    });

    it('editar os recursos de um plano vale para todos os estabelecimentos nele', async () => {
      const manager = await login(t.browser(), world.managerA.email);
      expect((await manager.get(`/api/establishments/${world.estA.id}/technical-sheets`)).status).toBe(200);
      const updated = await admin.patch(`/api/admin/plans/${world.plans.business.id}`).set(CSRF).send({ features: ['floor_plan', 'waitlist', 'promotions'] });
      expect(updated.status).toBe(200);
      expect(updated.body.establishmentCount).toBe(2);
      expect((await manager.get(`/api/establishments/${world.estA.id}/technical-sheets`)).status).toBe(403);
    });

    it('CRUD de planos e bloqueio de exclusão de plano em uso', async () => {
      const created = await admin.post('/api/admin/plans').set(CSRF).send({ name: 'Mini', monthlyPriceCents: 4900, limits: { units: 1, tables: 5, staff: 2 }, features: ['waitlist'] });
      expect(created.status).toBe(201);
      expect((await admin.post('/api/admin/plans').set(CSRF).send({ name: 'Mini', monthlyPriceCents: 1, limits: { units: 1, tables: 1, staff: 1 }, features: [] })).status).toBe(409);
      expect((await admin.delete(`/api/admin/plans/${world.plans.business.id}`).set(CSRF)).status).toBe(409);
      expect((await admin.delete(`/api/admin/plans/${created.body.id}`).set(CSRF)).status).toBe(204);
    });
  });

  describe('usuários e permissões', () => {
    it('edita papel, permissões e vínculos e registra antes/depois no histórico', async () => {
      const response = await admin.patch(`/api/admin/users/${world.client.id}/access`).set(CSRF).send({
        role: 'attendant',
        permissions: ['tables.view', 'menu.availability'],
        establishmentIds: [world.estB.id],
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ role: 'attendant', memberships: [{ establishmentId: world.estB.id }] });

      const audit = await admin.get(`/api/admin/permission-audit?userId=${world.client.id}`);
      expect(audit.body.items.map((entry: { action: string }) => entry.action).sort()).toEqual(['memberships_changed', 'permissions_changed', 'role_changed']);
      const roleEntry = audit.body.items.find((entry: { action: string }) => entry.action === 'role_changed');
      expect(roleEntry).toMatchObject({ actorName: 'Admin', targetUserName: 'Cliente', before: { role: 'client' }, after: { role: 'attendant' } });

      // O novo atendente já opera o estabelecimento vinculado, e só ele.
      const attendant = await login(t.browser(), world.client.email);
      expect((await attendant.get(`/api/establishments/${world.estB.id}/menu/items`)).status).toBe(200);
      expect((await attendant.get(`/api/establishments/${world.estA.id}/menu/items`)).status).toBe(403);
    });

    it('recusa permissões incompatíveis com o papel e vínculo ausente', async () => {
      const incompatible = await admin.patch(`/api/admin/users/${world.client.id}/access`).set(CSRF).send({ role: 'client', permissions: ['platform.users'] });
      expect(incompatible.status).toBe(422);
      const noMembership = await admin.patch(`/api/admin/users/${world.client.id}/access`).set(CSRF).send({ role: 'manager', permissions: ['menu.edit'] });
      expect(noMembership.status).toBe(422);
      expect(noMembership.body.code).toBe('MEMBERSHIP_REQUIRED');
    });

    it('impede o admin de alterar ou suspender a própria conta', async () => {
      const self = await admin.patch(`/api/admin/users/${world.admin.id}/status`).set(CSRF).send({ status: 'suspended' });
      expect(self.status).toBe(403);
      expect(self.body.code).toBe('SELF_MODIFICATION_FORBIDDEN');
    });

    it('filtra por papel e conta usuários por papel', async () => {
      const managers = await admin.get('/api/admin/users?role=manager');
      expect(managers.body.items).toHaveLength(3);
      expect(managers.body.counts).toMatchObject({ all: 7, admin: 2, manager: 3, attendant: 1, client: 1 });
    });

    it('reativar um usuário suspenso registra o histórico e devolve o acesso', async () => {
      await admin.patch(`/api/admin/users/${world.attendantA.id}/status`).set(CSRF).send({ status: 'suspended' });
      const reactivated = await admin.patch(`/api/admin/users/${world.attendantA.id}/status`).set(CSRF).send({ status: 'active' });
      expect(reactivated.body.status).toBe('active');
      const audit = await admin.get(`/api/admin/permission-audit?userId=${world.attendantA.id}`);
      expect(audit.body.items.map((entry: { action: string }) => entry.action)).toEqual(['reactivated', 'suspended']);
      const back = await login(t.browser(), world.attendantA.email);
      expect((await back.get('/api/me')).status).toBe(200);
    });
  });
});
