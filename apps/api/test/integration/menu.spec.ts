import sharp from 'sharp';
import { io, type Socket } from 'socket.io-client';
import { REALTIME_EVENTS } from '@filafacil/shared';
import { resetDatabase } from '../helpers/database.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createTestApp, CSRF, type TestApp } from '../helpers/test-app.js';

const DAY = 24 * 60 * 60 * 1000;

describe('Cardápio, disponibilidade e promoções (fichas 03, 19, 28, 29)', () => {
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

  const publicMenu = async (establishmentId: string) => (await t.browser().get(`/api/restaurants/${establishmentId}/menu`)).body.items as { id: string; name: string; priceCents: number; finalPriceCents: number }[];

  it('CRUD do gestor reflete no cardápio do cliente', async () => {
    const manager = await login(t.browser(), world.managerA.email);
    const base = `/api/establishments/${world.estA.id}/menu/items`;

    const created = await manager.post(base).set(CSRF).send({ name: 'Batata', description: 'Porção', categoryName: 'Porções', priceCents: 2590 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ category: 'Porções', priceCents: 2590, available: true });
    expect((await publicMenu(world.estA.id)).map(item => item.name)).toContain('Batata');

    const updated = await manager.patch(`${base}/${created.body.id}`).set(CSRF).send({ priceCents: 2990, name: 'Batata grande' });
    expect(updated.status).toBe(200);
    expect((await publicMenu(world.estA.id)).find(item => item.id === created.body.id)).toMatchObject({ name: 'Batata grande', priceCents: 2990 });

    expect((await manager.delete(`${base}/${created.body.id}`).set(CSRF)).status).toBe(204);
    expect((await publicMenu(world.estA.id)).map(item => item.id)).not.toContain(created.body.id);
    expect((await manager.get(base)).body.map((item: { id: string }) => item.id)).not.toContain(created.body.id);
  });

  it('rejeita preço inválido e link de imagem que não seja https', async () => {
    const manager = await login(t.browser(), world.managerA.email);
    const base = `/api/establishments/${world.estA.id}/menu/items`;
    expect((await manager.post(base).set(CSRF).send({ name: 'X', categoryName: 'A', priceCents: 0 })).status).toBe(400);
    expect((await manager.post(base).set(CSRF).send({ name: 'X', categoryName: 'A', priceCents: 10.5 })).status).toBe(400);
    expect((await manager.post(base).set(CSRF).send({ name: 'X', categoryName: 'A', priceCents: 100, imageUrl: 'javascript:alert(1)' })).status).toBe(400);
  });

  it('item indisponível some do cliente, registra quem alterou e avisa em tempo real', async () => {
    const socket: Socket = io(`http://localhost:${t.port}/realtime`, { path: '/api/socket.io', transports: ['websocket'] });
    await new Promise<void>(resolve => socket.on('connect', () => resolve()));
    await socket.emitWithAck('subscribe', { restaurantId: world.estA.id });
    const event = new Promise<unknown>(resolve => socket.once(REALTIME_EVENTS.menuUpdated, resolve));

    const attendant = await login(t.browser(), world.attendantA.email);
    const response = await attendant.patch(`/api/establishments/${world.estA.id}/menu/items/${world.itemA.id}/availability`).set(CSRF).send({ available: false });
    expect(response.status).toBe(200);
    await expect(event).resolves.toEqual({ establishmentId: world.estA.id });
    socket.close();

    expect((await publicMenu(world.estA.id)).map(item => item.id)).not.toContain(world.itemA.id);
    const history = await attendant.get(`/api/establishments/${world.estA.id}/menu/availability-history`);
    expect(history.body.items[0]).toMatchObject({ itemName: 'IPA', available: false, actorName: 'Atendente A' });

    await attendant.patch(`/api/establishments/${world.estA.id}/menu/items/${world.itemA.id}/availability`).set(CSRF).send({ available: true });
    expect((await publicMenu(world.estA.id)).map(item => item.id)).toContain(world.itemA.id);
    expect((await attendant.get(`/api/establishments/${world.estA.id}/menu/availability-history`)).body.total).toBe(2);
  });

  it('preço promocional só vale durante o período e sem alterar o preço original', async () => {
    const manager = await login(t.browser(), world.managerA.email);
    const base = `/api/establishments/${world.estA.id}/promotions`;
    const now = Date.now();
    const promotion = async (startOffset: number, endOffset: number, discountPercent: number) =>
      manager
        .post(base)
        .set(CSRF)
        .send({ name: 'Promo', discountPercent, itemIds: [world.itemA.id], startsAt: new Date(now + startOffset).toISOString(), endsAt: new Date(now + endOffset).toISOString() });

    expect((await promotion(-10 * DAY, -DAY, 50)).body.state).toBe('expired');
    expect((await promotion(DAY, 2 * DAY, 40)).body.state).toBe('scheduled');
    expect((await publicMenu(world.estA.id)).find(item => item.id === world.itemA.id)).toMatchObject({ priceCents: 2000, finalPriceCents: 2000 });

    const active = await promotion(-DAY, DAY, 20);
    expect(active.body.state).toBe('active');
    expect((await publicMenu(world.estA.id)).find(item => item.id === world.itemA.id)).toMatchObject({ priceCents: 2000, finalPriceCents: 1600 });
    expect((await t.prisma.menuItem.findUniqueOrThrow({ where: { id: world.itemA.id } })).priceCents).toBe(2000);

    // Encerramento automático pelo período: basta o fim ficar no passado.
    await t.prisma.promotion.update({ where: { id: active.body.id }, data: { endsAt: new Date(now - 1000) } });
    expect((await publicMenu(world.estA.id)).find(item => item.id === world.itemA.id)).toMatchObject({ finalPriceCents: 2000 });
  });

  it('valida período e itens da promoção', async () => {
    const manager = await login(t.browser(), world.managerA.email);
    const base = `/api/establishments/${world.estA.id}/promotions`;
    const now = Date.now();
    const backwards = await manager.post(base).set(CSRF).send({
      name: 'Errada', discountPercent: 10, itemIds: [world.itemA.id], startsAt: new Date(now + DAY).toISOString(), endsAt: new Date(now).toISOString(),
    });
    expect(backwards.status).toBe(422);
    const foreignItem = await manager.post(base).set(CSRF).send({
      name: 'Errada', discountPercent: 10, itemIds: [world.itemB.id], startsAt: new Date(now).toISOString(), endsAt: new Date(now + DAY).toISOString(),
    });
    expect(foreignItem.status).toBe(422);
    expect(foreignItem.body.code).toBe('INVALID_ITEMS');
  });

  it('upload de foto aceita imagem real e recusa arquivo disfarçado', async () => {
    const manager = await login(t.browser(), world.managerA.email);
    const url = `/api/establishments/${world.estA.id}/menu/items/${world.itemA.id}/photo`;
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#e8700a' } }).png().toBuffer();

    const uploaded = await manager.put(url).set(CSRF).attach('file', png, { filename: '../../evil.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.imageUrl).toMatch(/^\/api\/uploads\/[a-f0-9]{32}\.webp$/);
    const served = await t.browser().get(uploaded.body.imageUrl);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');

    const fake = await manager.put(url).set(CSRF).attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'foto.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    expect(fake.body.code).toBe('UNSUPPORTED_IMAGE');
  });
});
