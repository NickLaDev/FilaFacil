import { MenuRankingService } from '../../src/modules/menu/menu-ranking.service.js';
import { resetDatabase } from '../helpers/database.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createTestApp, CSRF, type TestApp } from '../helpers/test-app.js';

const DAY = 24 * 60 * 60 * 1000;

describe('Itens mais pedidos (ficha 46)', () => {
  let t: TestApp;
  let world: World;
  let ranking: MenuRankingService;
  let items: { id: string; name: string }[];

  beforeAll(async () => {
    t = await createTestApp();
    ranking = t.app.get(MenuRankingService);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    const category = await t.prisma.menuCategory.findFirstOrThrow({ where: { establishmentId: world.estA.id } });
    const extra = await Promise.all(
      ['Pilsen', 'Stout', 'Weiss', 'Lager'].map((name, index) =>
        t.prisma.menuItem.create({ data: { establishmentId: world.estA.id, categoryId: category.id, name, priceCents: 1000, position: index + 2 } }),
      ),
    );
    items = [world.itemA, ...extra];
  });

  /** Pedido direto no banco, com o pagamento no estado informado. */
  async function sell(itemId: string, quantity: number, opts: { daysAgo?: number; payment?: 'approved' | 'pending' | 'refunded'; status?: 'paid' | 'received' | 'cancelled'; establishmentId?: string } = {}) {
    const when = new Date(Date.now() - (opts.daysAgo ?? 1) * DAY);
    const order = await t.prisma.order.create({
      data: {
        userId: world.client.id,
        establishmentId: opts.establishmentId ?? world.estA.id,
        status: opts.status ?? 'paid',
        totalCents: 1000 * quantity,
        pickupCode: '1234',
        createdAt: when,
        items: { create: [{ menuItemId: itemId, name: 'x', unitPriceCents: 1000, quantity }] },
        payments: { create: [{ attempt: 1, method: 'pix', status: opts.payment ?? 'approved', amountCents: 1000 * quantity, approvedAt: opts.payment === 'pending' ? null : when }] },
      },
    });
    return order;
  }

  const menu = async () => (await t.browser().get(`/api/restaurants/${world.estA.id}/menu`)).body.items as { name: string; isTopOrdered: boolean; isHighlighted: boolean }[];
  const flag = (list: { name: string; isTopOrdered: boolean }[], name: string) => list.find(item => item.name === name)?.isTopOrdered;

  it('ranqueia por quantidade vendida em pedidos pagos dos últimos 30 dias (top 3), ignorando o resto', async () => {
    const [ipa, pilsen, stout, weiss, lager] = items as [typeof items[0], typeof items[0], typeof items[0], typeof items[0], typeof items[0]];
    await sell(ipa.id, 5);
    await sell(ipa.id, 3, { daysAgo: 29 });
    await sell(pilsen.id, 7);
    await sell(stout.id, 4);
    await sell(weiss.id, 20, { daysAgo: 31 }); // fora da janela
    await sell(lager.id, 50, { payment: 'pending', status: 'received' }); // não pago
    await sell(lager.id, 50, { payment: 'refunded', status: 'cancelled' }); // estornado
    await sell(world.itemB.id, 99, { establishmentId: world.estB.id }); // outra casa

    await ranking.recalculate();
    const rows = await t.prisma.menuItemRanking.findMany({ where: { establishmentId: world.estA.id }, orderBy: { rank: 'asc' } });
    expect(rows.map(row => [row.menuItemId, row.rank, row.quantity])).toEqual([
      [ipa.id, 1, 8],
      [pilsen.id, 2, 7],
      [stout.id, 3, 4],
    ]);
    expect(await t.prisma.menuItemRanking.count({ where: { establishmentId: world.estB.id } })).toBe(1);

    const list = await menu();
    expect(list.filter(item => item.isTopOrdered).map(item => item.name).sort()).toEqual(['IPA', 'Pilsen', 'Stout']);
    expect(flag(list, 'Weiss')).toBe(false);
  });

  it('recalcula automaticamente quando a semana vence, e só então', async () => {
    const [ipa, pilsen] = items as [typeof items[0], typeof items[0]];
    await sell(ipa.id, 2);
    const start = new Date();
    expect(await ranking.recalculateIfDue(start)).toBe(true);
    expect(flag(await menu(), 'IPA')).toBe(true);

    await sell(pilsen.id, 9);
    expect(await ranking.recalculateIfDue(new Date(start.getTime() + 6 * DAY))).toBe(false);
    expect(await t.prisma.menuItemRanking.count({ where: { menuItemId: pilsen.id } })).toBe(0);

    expect(await ranking.recalculateIfDue(new Date(start.getTime() + 7 * DAY + 1000))).toBe(true);
    expect(await t.prisma.menuItemRanking.count({ where: { menuItemId: pilsen.id } })).toBe(1);
    expect(await t.prisma.menuItemRanking.findUnique({ where: { menuItemId: pilsen.id } }).then(row => row?.rank)).toBe(1);
  });

  it('item que sai da janela ou é excluído deixa o ranking no recálculo', async () => {
    const [ipa, pilsen] = items as [typeof items[0], typeof items[0]];
    await sell(ipa.id, 2);
    await sell(pilsen.id, 1);
    await ranking.recalculate();
    await t.prisma.menuItem.update({ where: { id: ipa.id }, data: { deletedAt: new Date() } });
    await ranking.recalculate(world.estA.id);
    expect((await t.prisma.menuItemRanking.findMany({ where: { establishmentId: world.estA.id } })).map(row => row.menuItemId)).toEqual([pilsen.id]);
  });

  describe('destaque manual e ranking do gestor', () => {
    it('gestor destaca e remove; o destaque persiste e aparece no cardápio público', async () => {
      const manager = await login(t.browser(), world.managerA.email);
      const [, pilsen] = items as [typeof items[0], typeof items[0]];
      const url = `/api/establishments/${world.estA.id}/menu/items/${pilsen.id}/highlight`;
      expect((await manager.put(url).set(CSRF).send({ highlighted: true })).status).toBe(204);
      expect((await menu()).find(item => item.name === 'Pilsen')?.isHighlighted).toBe(true);
      expect((await manager.get(`/api/establishments/${world.estA.id}/menu/items`)).body.find((item: { id: string }) => item.id === pilsen.id).highlighted).toBe(true);
      // Recalcular o ranking não apaga o destaque manual.
      await manager.post(`/api/establishments/${world.estA.id}/menu/ranking/recalculate`).set(CSRF);
      expect((await menu()).find(item => item.name === 'Pilsen')?.isHighlighted).toBe(true);
      expect((await manager.put(url).set(CSRF).send({ highlighted: false })).status).toBe(204);
      expect((await menu()).find(item => item.name === 'Pilsen')?.isHighlighted).toBe(false);
      expect((await manager.put(url).set(CSRF).send({ highlighted: 'sim' })).status).toBe(400);
    });

    it('autorização: atendente e gestor de outra casa não destacam; item de outra casa é 404', async () => {
      const attendant = await login(t.browser(), world.attendantA.email);
      const managerB = await login(t.browser(), world.managerB.email);
      const manager = await login(t.browser(), world.managerA.email);
      const url = (establishmentId: string, itemId: string) => `/api/establishments/${establishmentId}/menu/items/${itemId}/highlight`;
      expect((await attendant.put(url(world.estA.id, world.itemA.id)).set(CSRF).send({ highlighted: true })).status).toBe(403);
      expect((await managerB.put(url(world.estA.id, world.itemA.id)).set(CSRF).send({ highlighted: true })).status).toBe(403);
      expect((await manager.put(url(world.estA.id, world.itemB.id)).set(CSRF).send({ highlighted: true })).status).toBe(404);
      expect((await attendant.get(`/api/establishments/${world.estA.id}/menu/ranking`)).status).toBe(403);
      expect((await t.browser().get(`/api/establishments/${world.estA.id}/menu/ranking`)).status).toBe(401);
    });

    it('GET ranking devolve posição, quantidade e data do cálculo', async () => {
      const manager = await login(t.browser(), world.managerA.email);
      const [ipa] = items as [typeof items[0]];
      expect((await manager.get(`/api/establishments/${world.estA.id}/menu/ranking`)).body).toEqual({ calculatedAt: null, items: [] });
      await sell(ipa.id, 3);
      const response = await manager.post(`/api/establishments/${world.estA.id}/menu/ranking/recalculate`).set(CSRF);
      expect(response.body.items).toEqual([{ menuItemId: ipa.id, name: 'IPA', quantity: 3, rank: 1, highlighted: false }]);
      expect(new Date(response.body.calculatedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    });
  });
});
