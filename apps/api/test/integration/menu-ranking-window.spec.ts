import { MenuRankingService } from '../../src/modules/menu/menu-ranking.service.js';
import { resetDatabase } from '../helpers/database.js';
import { createWorld, type World } from '../helpers/fixtures.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Relógio injetado: nenhum teste espera tempo real. */
const NOW = new Date('2026-06-15T12:00:00.000Z');

type OrderStatus = 'paid' | 'preparing' | 'ready' | 'delivered' | 'received' | 'cancelled';
type PaymentStatus = 'approved' | 'pending' | 'refunded' | 'refused' | 'expired' | 'cancelled';

describe('Itens mais pedidos: janela, regras e agenda semanal (ficha 46)', () => {
  let t: TestApp;
  let world: World;
  let ranking: MenuRankingService;
  let items: Record<string, string>;

  beforeAll(async () => {
    t = await createTestApp();
    ranking = t.app.get(MenuRankingService);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    const category = await t.prisma.menuCategory.findFirstOrThrow({ where: { establishmentId: world.estA.id } });
    items = { IPA: world.itemA.id };
    for (const [index, name] of ['Pilsen', 'Stout', 'Weiss', 'Lager', 'Bock'].entries()) {
      items[name] = (await t.prisma.menuItem.create({ data: { establishmentId: world.estA.id, categoryId: category.id, name, priceCents: 1000, position: index + 2 } })).id;
    }
  });

  /** Venda com pagamento aprovado `ageMs` antes de NOW (o pagamento aprovado é o que define a janela). */
  async function sell(name: string, quantity: number, opts: { ageMs?: number; status?: OrderStatus; payment?: PaymentStatus } = {}) {
    const approvedAt = new Date(NOW.getTime() - (opts.ageMs ?? DAY));
    const payment = opts.payment ?? 'approved';
    await t.prisma.order.create({
      data: {
        userId: world.client.id,
        establishmentId: world.estA.id,
        status: opts.status ?? 'paid',
        totalCents: 1000 * quantity,
        pickupCode: '1234',
        createdAt: approvedAt,
        items: { create: [{ menuItemId: items[name] as string, name, unitPriceCents: 1000, quantity }] },
        payments: { create: [{ attempt: 1, method: 'pix', status: payment, amountCents: 1000 * quantity, approvedAt: payment === 'approved' || payment === 'refunded' ? approvedAt : null }] },
      },
    });
  }

  const top = async () =>
    (await t.prisma.menuItemRanking.findMany({ where: { establishmentId: world.estA.id }, orderBy: { rank: 'asc' }, include: { menuItem: { select: { name: true } } } })).map(
      row => [row.menuItem.name, row.rank, row.quantity],
    );

  describe('janela de 30 dias', () => {
    it('inclui venda de 29d23h e exclui a de 30d + 1 min', async () => {
      await sell('IPA', 5, { ageMs: 29 * DAY + 23 * HOUR });
      await sell('Pilsen', 9, { ageMs: 30 * DAY + MIN });
      await ranking.recalculate(undefined, NOW);
      expect(await top()).toEqual([['IPA', 1, 5]]);
    });

    it('limite exato: 30d inclui (>=), 30d + 1 ms exclui', async () => {
      await sell('IPA', 2, { ageMs: 30 * DAY });
      await sell('Pilsen', 2, { ageMs: 30 * DAY + 1 });
      await ranking.recalculate(undefined, NOW);
      expect(await top()).toEqual([['IPA', 1, 2]]);
    });

    it('avançar o relógio faz a venda sair da janela', async () => {
      await sell('IPA', 4, { ageMs: 10 * DAY });
      await ranking.recalculate(undefined, NOW);
      expect(await top()).toEqual([['IPA', 1, 4]]);
      await ranking.recalculate(undefined, new Date(NOW.getTime() + 20 * DAY + MIN));
      expect(await top()).toEqual([]);
    });

    it('pagamento aprovado depois do instante de cálculo não conta', async () => {
      await sell('IPA', 3, { ageMs: -HOUR });
      await ranking.recalculate(undefined, NOW);
      expect(await top()).toEqual([]);
    });
  });

  describe('o que conta como venda', () => {
    it('só pedidos com pagamento aprovado: pago/preparo/pronto/entregue contam', async () => {
      await sell('IPA', 1, { status: 'paid' });
      await sell('Pilsen', 2, { status: 'preparing' });
      await sell('Stout', 3, { status: 'ready' });
      await sell('Weiss', 4, { status: 'delivered' });
      await ranking.recalculate(undefined, NOW);
      expect((await top()).map(row => row[0])).toEqual(['Weiss', 'Stout', 'Pilsen']);
    });

    it('não contam: pendente, rejeitado, estornado, cancelado e pedido cancelado com pagamento aprovado', async () => {
      await sell('IPA', 50, { status: 'received', payment: 'pending' });
      await sell('Pilsen', 50, { status: 'received', payment: 'refused' });
      await sell('Pilsen', 50, { status: 'received', payment: 'expired' });
      await sell('Stout', 50, { status: 'cancelled', payment: 'refunded' });
      await sell('Weiss', 50, { status: 'delivered', payment: 'refunded' }); // estorno depois da entrega
      await sell('Lager', 50, { status: 'cancelled', payment: 'approved' });
      await sell('Bock', 1);
      await ranking.recalculate(undefined, NOW);
      expect(await top()).toEqual([['Bock', 1, 1]]);
    });

    it('soma quantidade (volume), não número de pedidos', async () => {
      await sell('IPA', 1);
      await sell('IPA', 1);
      await sell('IPA', 1);
      await sell('Pilsen', 5);
      await ranking.recalculate(undefined, NOW);
      expect(await top()).toEqual([['Pilsen', 1, 5], ['IPA', 2, 3]]);
    });
  });

  describe('ordem, empate e top-N', () => {
    it('mostra no máximo 3 itens e ordena por quantidade decrescente', async () => {
      await sell('IPA', 1);
      await sell('Pilsen', 2);
      await sell('Stout', 3);
      await sell('Weiss', 4);
      await sell('Lager', 5);
      await ranking.recalculate(undefined, NOW);
      expect(await top()).toEqual([['Lager', 1, 5], ['Weiss', 2, 4], ['Stout', 3, 3]]);
    });

    it('empate: desempata por nome (A→Z), de forma determinística; o corte do top 3 respeita essa ordem', async () => {
      for (const name of ['Weiss', 'Stout', 'Pilsen', 'IPA']) await sell(name, 4);
      await ranking.recalculate(undefined, NOW);
      const first = await top();
      expect(first).toEqual([['IPA', 1, 4], ['Pilsen', 2, 4], ['Stout', 3, 4]]); // Weiss fica de fora do empate
      await ranking.recalculate(undefined, NOW);
      expect(await top()).toEqual(first);
    });

    it('com menos de 3 itens vendidos, só eles recebem o selo', async () => {
      await sell('Stout', 2);
      await ranking.recalculate(undefined, NOW);
      expect(await top()).toEqual([['Stout', 1, 2]]);
    });
  });

  describe('destaque manual independe do ranking', () => {
    it('item destacado sem vendas não entra no ranking, mantém o destaque e os dois selos são independentes', async () => {
      await sell('IPA', 5);
      await t.prisma.menuItem.update({ where: { id: items.Bock as string }, data: { highlighted: true } });
      await ranking.recalculate(undefined, NOW);
      await ranking.recalculateIfDue(new Date(NOW.getTime() + 8 * DAY));
      expect(await top()).toEqual([['IPA', 1, 5]]);
      expect((await t.prisma.menuItem.findUniqueOrThrow({ where: { id: items.Bock as string } })).highlighted).toBe(true);
      const menu = (await t.browser().get(`/api/restaurants/${world.estA.id}/menu`)).body.items as { name: string; isTopOrdered: boolean; isHighlighted: boolean }[];
      expect(menu.find(item => item.name === 'Bock')).toMatchObject({ isTopOrdered: false, isHighlighted: true });
      expect(menu.find(item => item.name === 'IPA')).toMatchObject({ isTopOrdered: true, isHighlighted: false });
    });
  });

  describe('recálculo semanal (recalculateIfDue)', () => {
    it('primeira execução calcula; 6d23h não vence; 7d vence; a data da execução avança', async () => {
      await sell('IPA', 2);
      expect(await ranking.recalculateIfDue(NOW)).toBe(true);
      expect((await t.prisma.rankingRun.findUniqueOrThrow({ where: { id: 1 } })).ranAt).toEqual(NOW);

      await sell('Pilsen', 9);
      expect(await ranking.recalculateIfDue(new Date(NOW.getTime() + 6 * DAY + 23 * HOUR))).toBe(false);
      expect(await top()).toEqual([['IPA', 1, 2]]);

      const weekLater = new Date(NOW.getTime() + 7 * DAY);
      expect(await ranking.recalculateIfDue(weekLater)).toBe(true);
      expect(await top()).toEqual([['Pilsen', 1, 9], ['IPA', 2, 2]]);
      expect((await t.prisma.rankingRun.findUniqueOrThrow({ where: { id: 1 } })).ranAt).toEqual(weekLater);
      // próxima semana conta a partir da última execução
      expect(await ranking.recalculateIfDue(new Date(weekLater.getTime() + 6 * DAY + 23 * HOUR))).toBe(false);
    });

    it('chamadas simultâneas: só uma executa o recálculo (lock + ranking_runs)', async () => {
      await sell('IPA', 2);
      const results = await Promise.all(Array.from({ length: 6 }, () => ranking.recalculateIfDue(NOW)));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await t.prisma.rankingRun.count()).toBe(1);
      expect(await t.prisma.menuItemRanking.count()).toBe(1);
    });

    it('recálculo manual não adianta nem atrasa a agenda semanal', async () => {
      await ranking.recalculateIfDue(NOW);
      await ranking.recalculate(world.estA.id, new Date(NOW.getTime() + 3 * DAY));
      expect((await t.prisma.rankingRun.findUniqueOrThrow({ where: { id: 1 } })).ranAt).toEqual(NOW);
      expect(await ranking.recalculateIfDue(new Date(NOW.getTime() + 7 * DAY))).toBe(true);
    });
  });
});
