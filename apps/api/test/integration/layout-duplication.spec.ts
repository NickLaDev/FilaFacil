import { resetDatabase } from '../helpers/database.js';
import { createUser, createWorld, login, type World } from '../helpers/fixtures.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

describe('Duplicar layout entre unidades (ficha 61)', () => {
  let t: TestApp;
  let world: World;
  let multi: Agent;
  let estOther: { id: string };

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    const otherOrg = await t.prisma.organization.create({ data: { name: 'Outra Rede' } });
    estOther = await t.prisma.establishment.create({
      data: { name: 'Bar Outra Rede', type: 'bar', city: 'Campinas', address: 'Rua X, 9', latitude: -22.9, longitude: -47.06, organizationId: otherOrg.id, planId: world.plans.business.id },
    });
    await createUser(t.prisma, { name: 'Gestor Multi', email: 'multi@test.dev', role: 'manager', establishmentIds: [world.estA.id, world.estB.id, world.estStart.id, estOther.id] });
    multi = await login(t.browser(), 'multi@test.dev');
  });

  const plan = (id: string) => `/api/establishments/${id}/floor-plan`;
  const sourceTables = [
    { label: 'Mesa 1', shape: 'round', capacity: 2, x: 12.5, y: 18 },
    { label: 'Mesa 2', shape: 'rect', capacity: 6, x: 70, y: 82 },
    { label: 'Balcão', shape: 'square', capacity: 4, x: 40, y: 50 },
  ];
  async function seedSource() {
    const saved = await multi.put(plan(world.estA.id)).set(CSRF).send({ version: 0, tables: sourceTables });
    expect(saved.status).toBe(200);
    return saved.body;
  }
  const duplicate = (from: string, body: object, agent: Agent = multi) => agent.post(`${plan(from)}/duplicate`).set(CSRF).send(body);
  const strip = (tables: { label: string; shape: string; capacity: number; x: number; y: number }[]) =>
    tables.map(({ label, shape, capacity, x, y }) => ({ label, shape, capacity, x, y })).sort((a, b) => a.label.localeCompare(b.label));

  it('copia todas as mesas com mesmas posições e capacidades, QR novos, e a origem não muda', async () => {
    const source = await seedSource();
    const copied = await duplicate(world.estA.id, { targetEstablishmentId: world.estB.id });
    expect(copied.status).toBe(201);
    expect(copied.body.establishmentId).toBe(world.estB.id);
    expect(strip(copied.body.tables)).toEqual(strip(sourceTables));
    const qrCodes = new Set([...source.tables, ...copied.body.tables].map((table: { qrCode: string }) => table.qrCode));
    expect(qrCodes.size).toBe(6);

    const after = (await multi.get(plan(world.estA.id))).body;
    expect(after.version).toBe(source.version);
    expect(after.tables.map((table: { id: string; qrCode: string }) => [table.id, table.qrCode])).toEqual(source.tables.map((table: { id: string; qrCode: string }) => [table.id, table.qrCode]));

    // Edições locais depois da cópia não afetam a origem.
    const target = (await multi.get(plan(world.estB.id))).body;
    const edited = target.tables.map((table: { id: string; label: string; shape: string; capacity: number; x: number; y: number }) => ({ id: table.id, label: table.label, shape: table.shape, capacity: 8, x: table.x, y: table.y }));
    expect((await multi.put(plan(world.estB.id)).set(CSRF).send({ version: target.version, tables: edited })).status).toBe(200);
    expect((await multi.get(plan(world.estA.id))).body.tables.map((table: { capacity: number }) => table.capacity).sort()).toEqual([2, 4, 6]);
  });

  it('destino com mesas exige confirmação de substituição', async () => {
    await seedSource();
    await multi.put(plan(world.estB.id)).set(CSRF).send({ version: 0, tables: [{ label: 'Antiga', shape: 'round', capacity: 2, x: 1, y: 1 }] });
    const refused = await duplicate(world.estA.id, { targetEstablishmentId: world.estB.id });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('TARGET_LAYOUT_NOT_EMPTY');
    expect((await multi.get(plan(world.estB.id))).body.tables.map((table: { label: string }) => table.label)).toEqual(['Antiga']);

    const replaced = await duplicate(world.estA.id, { targetEstablishmentId: world.estB.id, replace: true });
    expect(replaced.status).toBe(201);
    expect(strip(replaced.body.tables)).toEqual(strip(sourceTables));
  });

  it('é atômica: falha no destino (limite do plano) não altera nada', async () => {
    await seedSource();
    // Start permite 3 mesas e não inclui duplicação: recusado antes de qualquer escrita.
    const toStart = await duplicate(world.estA.id, { targetEstablishmentId: world.estStart.id });
    expect(toStart.status).toBe(403);
    expect(toStart.body.code).toBe('FEATURE_NOT_IN_PLAN');
    expect(await t.prisma.diningTable.count({ where: { establishmentId: world.estStart.id } })).toBe(0);

    await t.prisma.plan.update({ where: { id: world.plans.business.id }, data: { maxTables: 2 } });
    const tooMany = await duplicate(world.estA.id, { targetEstablishmentId: world.estB.id });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.code).toBe('TABLE_LIMIT_REACHED');
    expect(await t.prisma.diningTable.count({ where: { establishmentId: world.estB.id } })).toBe(0);
    expect(await t.prisma.floorPlan.count({ where: { establishmentId: world.estB.id } })).toBe(0);
  });

  it('valida organização, vínculo, origem vazia e destino igual à origem', async () => {
    await seedSource();
    const otherOrg = await duplicate(world.estA.id, { targetEstablishmentId: estOther.id });
    expect(otherOrg.status).toBe(403);
    expect(otherOrg.body.code).toBe('DIFFERENT_ORGANIZATION');
    expect(await t.prisma.diningTable.count({ where: { establishmentId: estOther.id } })).toBe(0);

    // Gestor da origem sem vínculo com o destino.
    const managerA = await login(t.browser(), world.managerA.email);
    expect((await duplicate(world.estA.id, { targetEstablishmentId: world.estB.id }, managerA)).status).toBe(403);
    // Gestor do destino sem vínculo com a origem.
    const managerB = await login(t.browser(), world.managerB.email);
    expect((await duplicate(world.estA.id, { targetEstablishmentId: world.estB.id }, managerB)).status).toBe(403);

    expect((await duplicate(world.estA.id, { targetEstablishmentId: world.estA.id })).body.code).toBe('SAME_ESTABLISHMENT');
    expect((await duplicate(world.estB.id, { targetEstablishmentId: world.estA.id })).body.code).toBe('SOURCE_LAYOUT_EMPTY');
    expect((await duplicate(world.estA.id, { targetEstablishmentId: 'x' })).status).toBe(400);
    expect((await t.browser().post(`${plan(world.estA.id)}/duplicate`).set(CSRF).send({ targetEstablishmentId: world.estB.id })).status).toBe(401);
  });

  it('atendente não duplica; lista de destinos mostra só a mesma organização e a razão de inelegíveis', async () => {
    const attendant = await login(t.browser(), world.attendantA.email);
    expect((await duplicate(world.estA.id, { targetEstablishmentId: world.estB.id }, attendant)).status).toBe(403);
    expect((await attendant.get(`${plan(world.estA.id)}/duplicate-targets`)).status).toBe(403);

    const targets = (await multi.get(`${plan(world.estA.id)}/duplicate-targets`)).body;
    expect(targets).toEqual([
      { id: world.estB.id, name: 'Bar B', tableCount: 0, eligible: true, reason: null },
      { id: world.estStart.id, name: 'Bar Start', tableCount: 0, eligible: false, reason: expect.stringContaining('Start') },
    ]);
  });
});
