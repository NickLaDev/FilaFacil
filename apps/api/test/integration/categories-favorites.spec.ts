import { resetDatabase } from '../helpers/database.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createTestApp, CSRF, type TestApp } from '../helpers/test-app.js';

describe('Filtro por categorias e favoritos (fichas 60 e 45)', () => {
  let t: TestApp;
  let world: World;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    await t.prisma.establishment.update({ where: { id: world.estA.id }, data: { foodCategories: ['Bar', 'Petiscos'] } });
    await t.prisma.establishment.update({ where: { id: world.estB.id }, data: { foodCategories: ['Japonesa'] } });
    await t.prisma.establishment.update({ where: { id: world.estStart.id }, data: { foodCategories: ['Bar', 'Lanches'], status: 'inactive' } });
  });

  const names = (body: { items: { name: string }[] }) => body.items.map(item => item.name).sort();

  describe('categorias (ficha 60)', () => {
    it('lista as categorias distintas de estabelecimentos ativos', async () => {
      const response = await t.browser().get('/api/restaurants/categories');
      expect(response.status).toBe(200);
      expect(response.body.categories).toEqual(['Bar', 'Japonesa', 'Petiscos']);
    });

    it('filtra por uma ou várias categorias (basta atender a uma) com ou sem coordenadas', async () => {
      const one = await t.browser().get('/api/restaurants?categories=Japonesa');
      expect(names(one.body)).toEqual(['Bar B']);
      const several = await t.browser().get('/api/restaurants?categories=Japonesa,Petiscos');
      expect(names(several.body)).toEqual(['Bar A', 'Bar B']);
      const repeated = await t.browser().get('/api/restaurants?categories=Japonesa&categories=Bar');
      expect(names(repeated.body)).toEqual(['Bar A', 'Bar B']);
      const near = await t.browser().get('/api/restaurants?lat=-22.9056&lng=-47.0608&categories=Japonesa,Lanches');
      expect(names(near.body)).toEqual(['Bar B']);
      const legacy = await t.browser().get('/api/restaurants?category=Bar');
      expect(names(legacy.body)).toEqual(['Bar A']);
      const none = await t.browser().get('/api/restaurants?categories=Inexistente');
      expect(none.body.total).toBe(0);
      const all = await t.browser().get('/api/restaurants');
      expect(names(all.body)).toEqual(['Bar A', 'Bar B']);
    });

    it('recusa lista exagerada', async () => {
      const response = await t.browser().get(`/api/restaurants?categories=${Array.from({ length: 11 }, (_, i) => `c${i}`).join(',')}`);
      expect(response.status).toBe(400);
    });
  });

  describe('favoritos (ficha 45)', () => {
    it('exige login', async () => {
      expect((await t.browser().get('/api/me/favorites')).status).toBe(401);
      expect((await t.browser().put(`/api/me/favorites/${world.estA.id}`).set(CSRF)).status).toBe(401);
    });

    it('favorita, lista, é idempotente e remove; vale em outro aparelho', async () => {
      const phone = await login(t.browser(), world.client.email);
      expect((await phone.put(`/api/me/favorites/${world.estA.id}`).set(CSRF)).body).toEqual({ favorited: true });
      expect((await phone.put(`/api/me/favorites/${world.estA.id}`).set(CSRF)).status).toBe(200);
      await phone.put(`/api/me/favorites/${world.estB.id}`).set(CSRF);

      const tablet = await login(t.browser(), world.client.email);
      const list = await tablet.get('/api/me/favorites');
      expect(list.body.items.map((item: { name: string }) => item.name)).toEqual(['Bar B', 'Bar A']);
      expect((await tablet.get('/api/me/favorites/ids')).body.ids).toEqual([world.estB.id, world.estA.id]);

      expect((await tablet.delete(`/api/me/favorites/${world.estB.id}`).set(CSRF)).status).toBe(204);
      expect((await tablet.delete(`/api/me/favorites/${world.estB.id}`).set(CSRF)).status).toBe(204);
      expect((await phone.get('/api/me/favorites/ids')).body.ids).toEqual([world.estA.id]);
    });

    it('favoritos são privados por conta e restaurante inativo não pode ser favoritado nem aparece', async () => {
      const client = await login(t.browser(), world.client.email);
      const other = await login(t.browser(), world.managerA.email);
      await client.put(`/api/me/favorites/${world.estA.id}`).set(CSRF);
      expect((await other.get('/api/me/favorites')).body.items).toEqual([]);
      expect((await client.put(`/api/me/favorites/${world.estStart.id}`).set(CSRF)).status).toBe(404);
      expect((await client.put('/api/me/favorites/not-a-uuid').set(CSRF)).status).toBe(400);

      await t.prisma.establishment.update({ where: { id: world.estA.id }, data: { status: 'inactive' } });
      expect((await client.get('/api/me/favorites')).body.items).toEqual([]);
    });
  });
});
