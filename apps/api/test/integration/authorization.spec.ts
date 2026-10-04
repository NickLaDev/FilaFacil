import { resetDatabase } from '../helpers/database.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createTestApp, CSRF, type TestApp } from '../helpers/test-app.js';

describe('Autorização no backend (RBAC + vínculo + plano)', () => {
  let t: TestApp;
  let world: World;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
  });

  it('gestor do estabelecimento A não acessa nem edita o B', async () => {
    const manager = await login(t.browser(), world.managerA.email);
    const read = await manager.get(`/api/establishments/${world.estB.id}/menu/items`);
    expect(read.status).toBe(403);
    expect(read.body.code).toBe('ESTABLISHMENT_ACCESS_DENIED');
    const create = await manager
      .post(`/api/establishments/${world.estB.id}/menu/items`)
      .set(CSRF)
      .send({ name: 'Invasor', categoryName: 'Cervejas', priceCents: 100 });
    expect(create.status).toBe(403);
    expect(await t.prisma.menuItem.count({ where: { establishmentId: world.estB.id } })).toBe(1);
  });

  it('não permite IDOR: item de outro estabelecimento via rota do próprio responde 404', async () => {
    const manager = await login(t.browser(), world.managerA.email);
    const response = await manager.patch(`/api/establishments/${world.estA.id}/menu/items/${world.itemB.id}`).set(CSRF).send({ priceCents: 1 });
    expect(response.status).toBe(404);
    expect((await t.prisma.menuItem.findUniqueOrThrow({ where: { id: world.itemB.id } })).priceCents).toBe(1000);
  });

  it('atendente A não altera disponibilidade de item do estabelecimento B', async () => {
    const attendant = await login(t.browser(), world.attendantA.email);
    const other = await attendant.patch(`/api/establishments/${world.estB.id}/menu/items/${world.itemB.id}/availability`).set(CSRF).send({ available: false });
    expect(other.status).toBe(403);
    const crossed = await attendant.patch(`/api/establishments/${world.estA.id}/menu/items/${world.itemB.id}/availability`).set(CSRF).send({ available: false });
    expect(crossed.status).toBe(404);
    expect((await t.prisma.menuItem.findUniqueOrThrow({ where: { id: world.itemB.id } })).available).toBe(true);
  });

  it('atendente sem permissão de edição não cadastra itens', async () => {
    const attendant = await login(t.browser(), world.attendantA.email);
    const response = await attendant
      .post(`/api/establishments/${world.estA.id}/menu/items`)
      .set(CSRF)
      .send({ name: 'Novo', categoryName: 'Cervejas', priceCents: 100 });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('MISSING_PERMISSION');
  });

  it('cliente e anônimo não acessam endpoints administrativos', async () => {
    const client = await login(t.browser(), world.client.email);
    const asClient = await client.get('/api/admin/users');
    expect(asClient.status).toBe(403);
    expect(asClient.body.code).toBe('ADMIN_ONLY');
    expect((await t.browser().get('/api/admin/users')).status).toBe(401);
    const manager = await login(t.browser(), world.managerA.email);
    expect((await manager.get('/api/admin/plans')).status).toBe(403);
  });

  it('plano sem o recurso bloqueia o endpoint mesmo com permissão', async () => {
    const manager = await login(t.browser(), world.managerStart.email);
    const response = await manager.get(`/api/establishments/${world.estStart.id}/promotions`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FEATURE_NOT_IN_PLAN');
    expect((await manager.get(`/api/establishments/${world.estStart.id}/technical-sheets`)).status).toBe(403);
    expect((await manager.get(`/api/establishments/${world.estStart.id}/waitlist`)).status).toBe(200);
  });

  it('estabelecimento suspenso bloqueia a equipe', async () => {
    await t.prisma.establishment.update({ where: { id: world.estA.id }, data: { status: 'suspended' } });
    const manager = await login(t.browser(), world.managerA.email);
    const response = await manager.get(`/api/establishments/${world.estA.id}/menu/items`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ESTABLISHMENT_SUSPENDED');
  });

  it('endereço de outro usuário responde 404 (sem IDOR)', async () => {
    const owner = await login(t.browser(), world.client.email);
    const created = await owner.post('/api/me/addresses').set(CSRF).send({ label: 'Casa', street: 'Rua A, 1', city: 'Campinas' });
    expect(created.status).toBe(201);
    const intruder = await login(t.browser(), world.managerA.email);
    const response = await intruder.delete(`/api/me/addresses/${created.body.id}`).set(CSRF);
    expect(response.status).toBe(404);
    expect(await t.prisma.userAddress.count()).toBe(1);
  });
});
