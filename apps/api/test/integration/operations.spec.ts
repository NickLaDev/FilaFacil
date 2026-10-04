import { resetDatabase } from '../helpers/database.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createTestApp, CSRF, type TestApp } from '../helpers/test-app.js';

type Agent = Awaited<ReturnType<typeof login>>;

describe('Planta, fila de espera e fichas técnicas (fichas 20, 21, 31)', () => {
  let t: TestApp;
  let world: World;
  let manager: Agent;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    t.sms.messages.length = 0;
    manager = await login(t.browser(), world.managerA.email);
  });

  const floorUrl = () => `/api/establishments/${world.estA.id}/floor-plan`;
  const waitlistUrl = () => `/api/establishments/${world.estA.id}/waitlist`;

  async function saveTables(tables: Record<string, unknown>[], version = 0) {
    return manager.put(floorUrl()).set(CSRF).send({ version, tables });
  }

  describe('planta do salão', () => {
    it('persiste posição, formato e capacidade exatamente como salvos', async () => {
      const saved = await saveTables([
        { label: 'Mesa 1', shape: 'round', capacity: 2, x: 12.5, y: 18 },
        { label: 'Mesa 2', shape: 'rect', capacity: 6, x: 70, y: 82 },
      ]);
      expect(saved.status).toBe(200);
      expect(saved.body.version).toBe(1);
      const [first, second] = saved.body.tables;
      expect(first.qrCode).toMatch(/^[A-Z]+-\d{4}$/);

      const moved = await saveTables(
        [
          { id: first.id, label: 'Mesa 1', shape: 'square', capacity: 4, x: 40, y: 33 },
          { id: second.id, label: 'Mesa 2', shape: 'rect', capacity: 6, x: 70, y: 82 },
        ],
        1,
      );
      expect(moved.status).toBe(200);

      // O mesmo layout é lido pelo atendente (mapa de mesas).
      const attendant = await login(t.browser(), world.attendantA.email);
      const reloaded = await attendant.get(floorUrl());
      expect(reloaded.body.version).toBe(2);
      expect(reloaded.body.tables.find((table: { id: string }) => table.id === first.id)).toMatchObject({ shape: 'square', capacity: 4, x: 40, y: 33, qrCode: first.qrCode });
    });

    it('troca nomes entre mesas no mesmo salvamento sem violar o índice único', async () => {
      const saved = await saveTables([
        { label: 'Mesa 1', shape: 'round', capacity: 2, x: 10, y: 10 },
        { label: 'Mesa 2', shape: 'round', capacity: 2, x: 20, y: 20 },
      ]);
      const [first, second] = saved.body.tables;
      const swapped = await saveTables(
        [
          { id: first.id, label: 'Mesa 2', shape: 'round', capacity: 2, x: 10, y: 10 },
          { id: second.id, label: 'Mesa 1', shape: 'round', capacity: 2, x: 20, y: 20 },
        ],
        1,
      );
      expect(swapped.status).toBe(200);
    });

    it('detecta edição concorrente pela versão', async () => {
      await saveTables([{ label: 'Mesa 1', shape: 'round', capacity: 2, x: 10, y: 10 }]);
      const stale = await saveTables([{ label: 'Mesa 9', shape: 'round', capacity: 2, x: 10, y: 10 }], 0);
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('FLOOR_PLAN_CONFLICT');
    });

    it('respeita o limite de mesas do plano e as permissões', async () => {
      const startManager = await login(t.browser(), world.managerStart.email);
      const tooMany = await startManager
        .put(`/api/establishments/${world.estStart.id}/floor-plan`)
        .set(CSRF)
        .send({ version: 0, tables: [1, 2, 3, 4].map(n => ({ label: `Mesa ${n}`, shape: 'round', capacity: 2, x: n * 10, y: 10 })) });
      expect(tooMany.status).toBe(422);
      expect(tooMany.body.code).toBe('TABLE_LIMIT_REACHED');

      const attendant = await login(t.browser(), world.attendantA.email);
      expect((await attendant.put(floorUrl()).set(CSRF).send({ version: 0, tables: [] })).status).toBe(403);
    });

    it('recusa mesa de outra planta', async () => {
      const otherManager = await login(t.browser(), world.managerB.email);
      const other = await otherManager
        .put(`/api/establishments/${world.estB.id}/floor-plan`)
        .set(CSRF)
        .send({ version: 0, tables: [{ label: 'Mesa 1', shape: 'round', capacity: 2, x: 10, y: 10 }] });
      const response = await saveTables([{ id: other.body.tables[0].id, label: 'Roubada', shape: 'round', capacity: 2, x: 10, y: 10 }]);
      expect(response.status).toBe(422);
    });
  });

  describe('fila de espera', () => {
    const add = (name: string, partySize: number) => manager.post(waitlistUrl()).set(CSRF).send({ name, phone: '(19) 98888-7777', partySize });

    it('adiciona em ordem, reordena e remove', async () => {
      const ana = await add('Ana', 2);
      const bia = await add('Bia', 4);
      const caio = await add('Caio', 2);
      expect([ana.body.position, bia.body.position, caio.body.position]).toEqual([1, 2, 3]);

      const moved = await manager.patch(`${waitlistUrl()}/${caio.body.id}/position`).set(CSRF).send({ position: 1 });
      expect(moved.status).toBe(200);
      expect(moved.body.entries.map((entry: { name: string }) => entry.name)).toEqual(['Caio', 'Ana', 'Bia']);

      expect((await manager.delete(`${waitlistUrl()}/${ana.body.id}`).set(CSRF)).status).toBe(204);
      const list = await manager.get(waitlistUrl());
      expect(list.body.entries.map((entry: { name: string; position: number }) => [entry.name, entry.position])).toEqual([
        ['Caio', 1],
        ['Bia', 2],
      ]);
    });

    it('estima a espera pelas mesas livres', async () => {
      await saveTables([{ label: 'Mesa 1', shape: 'round', capacity: 2, x: 10, y: 10 }]);
      const first = await add('Ana', 2);
      const second = await add('Bia', 2);
      expect(first.body.estimatedWaitMinutes).toBe(0);
      expect(second.body.estimatedWaitMinutes).toBe(12);
      expect((await manager.get(waitlistUrl())).body.freeTables).toBe(1);
    });

    it('ao liberar uma mesa, avisa automaticamente o primeiro grupo que cabe nela', async () => {
      const saved = await saveTables([{ label: 'Mesa 5', shape: 'square', capacity: 4, x: 10, y: 10 }]);
      const table = saved.body.tables[0];
      await t.prisma.diningTable.update({ where: { id: table.id }, data: { occupancy: 'occupied', occupiedPartySize: 4 } });
      await add('Grupo grande', 6);
      const fits = await add('Grupo médio', 3);

      const released = await manager.post(`/api/establishments/${world.estA.id}/floor-plan/tables/release`).set(CSRF).send({ tableIds: [table.id] });
      expect(released.status).toBe(200);
      expect(released.body.notifiedEntry).toMatchObject({ id: fits.body.id, status: 'notified', notifiedTableLabel: 'Mesa 5' });
      expect(t.sms.messages.at(-1)?.message).toContain('sua mesa está pronta');
      expect(await t.prisma.waitlistNotification.count({ where: { entryId: fits.body.id, status: 'sent' } })).toBe(1);

      // Sentar o grupo avisado ocupa a mesa liberada.
      expect((await manager.post(`${waitlistUrl()}/${fits.body.id}/seat`).set(CSRF)).status).toBe(204);
      expect((await t.prisma.diningTable.findUniqueOrThrow({ where: { id: table.id } })).occupancy).toBe('occupied');
    });

    it('requisições simultâneas nunca recebem a mesma posição', async () => {
      const responses = await Promise.all(Array.from({ length: 15 }, (_, index) => add(`Grupo ${index + 1}`, 2)));
      expect(responses.every(response => response.status === 201)).toBe(true);
      const positions = (await t.prisma.waitlistEntry.findMany({ where: { establishmentId: world.estA.id }, select: { position: true } }))
        .map(entry => entry.position)
        .sort((a, b) => a - b);
      expect(positions).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
    });
  });

  describe('fichas técnicas', () => {
    it('calcula o custo no servidor e recalcula ao mudar o preço do insumo', async () => {
      const base = `/api/establishments/${world.estA.id}`;
      const gin = await manager.post(`${base}/ingredients`).set(CSRF).send({ name: 'Gin', unit: 'ml', unitCost: 0.12 });
      const tonic = await manager.post(`${base}/ingredients`).set(CSRF).send({ name: 'Tônica', unit: 'ml', unitCost: 0.0134 });
      expect(gin.status).toBe(201);

      const sheet = await manager
        .put(`${base}/technical-sheets/${world.itemA.id}`)
        .set(CSRF)
        .send({ costLimitPercent: 35, lines: [{ ingredientId: gin.body.id, quantity: 50 }, { ingredientId: tonic.body.id, quantity: 150 }] });
      expect(sheet.status).toBe(200);
      expect(sheet.body).toMatchObject({ totalCost: '8.0100', costPercent: 40.1, overLimit: true });

      await manager.patch(`${base}/ingredients/${gin.body.id}`).set(CSRF).send({ unitCost: 0.08 });
      const [recalculated] = (await manager.get(`${base}/technical-sheets`)).body;
      expect(recalculated).toMatchObject({ totalCost: '6.0100', costPercent: 30.1, overLimit: false });
    });

    it('não aceita custo enviado pelo cliente nem insumo de outro estabelecimento', async () => {
      const base = `/api/establishments/${world.estA.id}`;
      const ingredient = await manager.post(`${base}/ingredients`).set(CSRF).send({ name: 'Limão', unit: 'un', unitCost: 1.6 });
      const forged = await manager
        .put(`${base}/technical-sheets/${world.itemA.id}`)
        .set(CSRF)
        .send({ costLimitPercent: 30, totalCost: '0.01', lines: [{ ingredientId: ingredient.body.id, quantity: 1 }] });
      expect(forged.status).toBe(400);

      const otherManager = await login(t.browser(), world.managerB.email);
      const foreign = await otherManager.post(`/api/establishments/${world.estB.id}/ingredients`).set(CSRF).send({ name: 'Sal', unit: 'g', unitCost: 0.01 });
      const response = await manager
        .put(`${base}/technical-sheets/${world.itemA.id}`)
        .set(CSRF)
        .send({ costLimitPercent: 30, lines: [{ ingredientId: foreign.body.id, quantity: 1 }] });
      expect(response.status).toBe(422);
    });
  });
});
