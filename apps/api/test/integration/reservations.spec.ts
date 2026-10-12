import { resetDatabase } from '../helpers/database.js';
import { createUser, createWorld, login, type World } from '../helpers/fixtures.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

describe('Reserva do cliente na página do restaurante (ficha 12)', () => {
  let t: TestApp;
  let world: World;
  let client: Agent;
  let manager: Agent;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    client = await login(t.browser(), world.client.email);
    manager = await login(t.browser(), world.managerA.email);
  });

  const url = (id = world.estA.id) => `/api/restaurants/${id}/reservation`;
  const reserve = (partySize = 3, body: Record<string, unknown> = {}, agent = client, id = world.estA.id) =>
    agent.post(url(id)).set(CSRF).send({ partySize, ...body });

  it('exige login', async () => {
    expect((await t.browser().get(url())).status).toBe(401);
    expect((await t.browser().post(url()).set(CSRF).send({ partySize: 2 })).status).toBe(401);
  });

  it('página do restaurante informa se a reserva está disponível', async () => {
    expect((await t.browser().get(`/api/restaurants/${world.estA.id}`)).body.reservationsOpen).toBe(true);
    await t.prisma.openingHour.deleteMany({ where: { establishmentId: world.estB.id } });
    expect((await t.browser().get(`/api/restaurants/${world.estB.id}`)).body.reservationsOpen).toBe(false);
    await t.prisma.planFeatureGrant.deleteMany({ where: { planId: world.plans.start.id, feature: 'waitlist' } });
    expect((await t.browser().get(`/api/restaurants/${world.estStart.id}`)).body.reservationsOpen).toBe(false);
  });

  it('cria uma entrada real na fila, visível para a equipe, com o nome e o celular da conta', async () => {
    const response = await reserve(3);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ partySize: 3, position: 1, status: 'waiting' });
    expect(response.body.phone).toBeUndefined();

    const staff = await manager.get(`/api/establishments/${world.estA.id}/waitlist`);
    expect(staff.body.entries).toHaveLength(1);
    expect(staff.body.entries[0]).toMatchObject({ name: 'Cliente', phone: '19999990000', partySize: 3, byCustomer: true });

    const mine = await client.get(url());
    expect(mine.body).toMatchObject({ hasPhone: true, reservation: { id: response.body.id, position: 1 } });
  });

  it('posição acompanha a fila: sobe quando a equipe remove quem estava na frente', async () => {
    const first = await manager.post(`/api/establishments/${world.estA.id}/waitlist`).set(CSRF).send({ name: 'Ana', phone: '(19) 98888-7777', partySize: 2 });
    expect((await reserve(2)).body.position).toBe(2);
    await manager.delete(`/api/establishments/${world.estA.id}/waitlist/${first.body.id}`).set(CSRF);
    expect((await client.get(url())).body.reservation.position).toBe(1);
  });

  it('é avisado quando a equipe libera uma mesa compatível', async () => {
    const saved = await manager
      .put(`/api/establishments/${world.estA.id}/floor-plan`)
      .set(CSRF)
      .send({ version: 0, tables: [{ label: 'Mesa 5', shape: 'square', capacity: 4, x: 10, y: 10 }] });
    await t.prisma.diningTable.update({ where: { id: saved.body.tables[0].id }, data: { occupancy: 'occupied', occupiedPartySize: 2 } });
    await reserve(3);
    await manager.post(`/api/establishments/${world.estA.id}/floor-plan/tables/release`).set(CSRF).send({ tableIds: [saved.body.tables[0].id] });
    expect((await client.get(url())).body.reservation).toMatchObject({ status: 'notified', notifiedTableLabel: 'Mesa 5' });
    expect(t.sms.messages.at(-1)?.message).toContain('sua mesa está pronta');
  });

  it('bloqueia reserva duplicada, inclusive requisições simultâneas', async () => {
    expect((await reserve(2)).status).toBe(201);
    const duplicate = await reserve(2);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('ALREADY_RESERVED');

    await client.delete(url()).set(CSRF);
    const results = await Promise.all(Array.from({ length: 5 }, () => reserve(2)));
    expect(results.filter(r => r.status === 201)).toHaveLength(1);
    expect(results.filter(r => r.status === 409)).toHaveLength(4);
    expect(await t.prisma.waitlistEntry.count({ where: { customerId: world.client.id, status: 'waiting' } })).toBe(1);
  });

  it('valida o tamanho do grupo e o celular', async () => {
    for (const partySize of [0, 51, 2.5, '3']) expect((await reserve(partySize as number)).status).toBe(400);
    const noPhone = await createUser(t.prisma, { name: 'Sem Celular', email: 'sem.cel@test.dev', role: 'client' });
    const agent = await login(t.browser(), noPhone.email);
    expect((await agent.get(url())).body.hasPhone).toBe(false);
    expect((await reserve(2, {}, agent)).status).toBe(400);
    expect((await reserve(2, { phone: '123' }, agent)).status).toBe(400);
    const ok = await reserve(2, { phone: '(19) 98888-7777' }, agent);
    expect(ok.status).toBe(201);
    expect((await t.prisma.waitlistEntry.findUniqueOrThrow({ where: { id: ok.body.id } })).phone).toBe('19988887777');
  });

  it('recusa restaurante fechado, plano sem fila, inexistente e contas da equipe', async () => {
    await t.prisma.openingHour.deleteMany({ where: { establishmentId: world.estB.id } });
    expect((await reserve(2, {}, client, world.estB.id)).status).toBe(409);

    await t.prisma.planFeatureGrant.deleteMany({ where: { planId: world.plans.start.id, feature: 'waitlist' } });
    const noFeature = await reserve(2, {}, client, world.estStart.id);
    expect(noFeature.status).toBe(409);

    expect((await reserve(2, {}, client, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await reserve(2, {}, manager)).status).toBe(403);
    expect(await t.prisma.waitlistEntry.count()).toBe(0);
  });

  it('lista as reservas ativas do cliente em todos os restaurantes (atalho do perfil)', async () => {
    expect((await t.browser().get('/api/me/reservations')).status).toBe(401);
    expect((await client.get('/api/me/reservations')).body).toEqual({ items: [] });
    await manager.post(`/api/establishments/${world.estA.id}/waitlist`).set(CSRF).send({ name: 'Ana', phone: '(19) 98888-7777', partySize: 2 });
    await reserve(3);
    await reserve(4, {}, client, world.estB.id);
    const list = (await client.get('/api/me/reservations')).body.items;
    expect(list.map((item: { restaurantName: string; position: number; partySize: number }) => [item.restaurantName, item.position, item.partySize]).sort()).toEqual([
      ['Bar A', 2, 3],
      ['Bar B', 1, 4],
    ]);
    await client.delete(url()).set(CSRF);
    expect((await client.get('/api/me/reservations')).body.items).toHaveLength(1);
  });

  it('cancelar tira da fila; sem reserva responde 404', async () => {
    expect((await client.delete(url()).set(CSRF)).status).toBe(404);
    await reserve(2);
    expect((await client.delete(url()).set(CSRF)).status).toBe(204);
    expect((await client.get(url())).body.reservation).toBeNull();
    expect((await manager.get(`/api/establishments/${world.estA.id}/waitlist`)).body.entries).toHaveLength(0);
  });

  it('um cliente não enxerga nem cancela a reserva de outro', async () => {
    await reserve(2);
    const other = await createUser(t.prisma, { name: 'Outro', email: 'outro@test.dev', role: 'client', phone: '19977776666' });
    const agent = await login(t.browser(), other.email);
    expect((await agent.get(url())).body.reservation).toBeNull();
    expect((await agent.delete(url()).set(CSRF)).status).toBe(404);
    expect(await t.prisma.waitlistEntry.count({ where: { status: 'waiting' } })).toBe(1);
  });

  it('excluir a conta tira a reserva da fila e anonimiza nome e celular', async () => {
    const created = await reserve(2);
    const deleted = await client.delete('/api/me').set(CSRF).send({ password: 'Senha123' });
    expect([200, 204]).toContain(deleted.status);
    const entry = await t.prisma.waitlistEntry.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(entry).toMatchObject({ status: 'removed', name: 'Conta excluída', phone: '00000000000', customerId: null });
  });
});
