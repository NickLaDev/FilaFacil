import { BillingService } from '../../src/modules/billing/billing.service.js';
import { IngredientLotsService } from '../../src/modules/ingredient-lots/ingredient-lots.service.js';
import { MonitoringService } from '../../src/modules/monitoring/monitoring.service.js';
import { resetDatabase } from '../helpers/database.js';
import { createUser, createWorld, login, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, seedOrder } from '../helpers/orders.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const long = new Date('2020-01-01T00:00:00Z');

describe('Sprint 4 — gestão da plataforma e da casa (33, 38, 39, 57, 66, 70)', () => {
  let t: TestApp;
  let world: World;
  let admin: Agent;
  let manager: Agent;
  let managerB: Agent;
  let attendant: Agent;
  const est = () => `/api/establishments/${world.estA.id}`;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    await createOrdersWorld(t.prisma, world);
    // Estabelecimentos "antigos": a cobrança não depende da data real em que o teste roda.
    await t.prisma.establishment.updateMany({ data: { createdAt: long } });
    admin = await login(t.browser(), world.admin.email);
    manager = await login(t.browser(), world.managerA.email);
    managerB = await login(t.browser(), world.managerB.email);
    attendant = await login(t.browser(), world.attendantA.email);
    t.email.messages.length = 0;
  });

  // ─── Ficha 57 ─────────────────────────────────────────────────────────────

  describe('relatório de custo por período (57)', () => {
    const setup = async () => {
      const cheese = await t.prisma.ingredient.create({ data: { establishmentId: world.estA.id, name: 'Queijo', unit: 'kg', unitCost: '40.0000' } });
      const malt = await t.prisma.ingredient.create({ data: { establishmentId: world.estA.id, name: 'Malte', unit: 'kg', unitCost: '12.5000' } });
      // IPA (R$ 20,00): 0,25 kg de queijo = R$ 10,00 por unidade.
      await t.prisma.technicalSheet.create({ data: { menuItemId: world.itemA.id, costLimitPercent: '60', items: { create: [{ ingredientId: cheese.id, quantity: '0.2500' }] } } });
      const snacks = await t.prisma.menuCategory.create({ data: { establishmentId: world.estA.id, name: 'Petiscos', position: 2 } });
      const fries = await t.prisma.menuItem.create({ data: { establishmentId: world.estA.id, categoryId: snacks.id, name: 'Fritas', priceCents: 3000, position: 1 } });
      const mystery = await t.prisma.menuItem.create({ data: { establishmentId: world.estA.id, categoryId: snacks.id, name: 'Prato do dia', priceCents: 4000, position: 2 } });
      // Fritas: 0,3333 kg de malte (R$ 12,50/kg) + 0,1 kg de queijo → 4,16625 + 4,00 = R$ 8,16625 por unidade.
      await t.prisma.technicalSheet.create({ data: { menuItemId: fries.id, costLimitPercent: '40', items: { create: [{ ingredientId: malt.id, quantity: '0.3333' }, { ingredientId: cheese.id, quantity: '0.1000' }] } } });
      return { fries, mystery };
    };
    const order = (itemId: string, name: string, price: number, qty: number, paidAt: Date, status: 'delivered' | 'cancelled' | 'received' = 'delivered', estId = world.estA.id) =>
      seedOrder(t.prisma, { userId: world.client.id, establishmentId: estId, status, paidAt, items: [{ menuItemId: itemId, name, unitPriceCents: price, quantity: qty }] });

    it('custo = custo da ficha × quantidade vendida, por item e por categoria, com margem', async () => {
      const { fries, mystery } = await setup();
      const today = new Date();
      await order(world.itemA.id, 'IPA', 2000, 2, today);
      await order(world.itemA.id, 'IPA', 2000, 1, today);
      await order(fries.id, 'Fritas', 3000, 3, today);
      await order(mystery.id, 'Prato do dia', 4000, 2, today);
      const day = today.toISOString().slice(0, 10);
      const res = await manager.get(`${est()}/reports/cost?from=${day}&to=${day}`);
      expect(res.status).toBe(200);
      const byName = Object.fromEntries((res.body.rows as { name: string }[]).map(row => [row.name, row]));
      // IPA: 3 un × R$ 10,00 = R$ 30,00 de custo; receita 3 × 20,00 = 60,00.
      expect(byName.IPA).toMatchObject({ quantity: 3, revenueCents: 6000, costCents: 3000, marginCents: 3000, marginPercent: 50, category: 'Cervejas' });
      // Fritas: 3 un × R$ 8,16625 = R$ 24,49875 → 2450 centavos; receita 90,00.
      expect(byName.Fritas).toMatchObject({ quantity: 3, revenueCents: 9000, costCents: 2450, marginCents: 6550 });
      expect(byName['Prato do dia']).toMatchObject({ quantity: 2, revenueCents: 8000, costCents: null, marginCents: null, marginPercent: null });
      expect(res.body.itemsWithoutSheet).toBe(1);
      expect(res.body.categories).toEqual([
        { category: 'Cervejas', quantity: 3, revenueCents: 6000, costCents: 3000, marginCents: 3000, marginPercent: 50 },
        { category: 'Petiscos', quantity: 3, revenueCents: 9000, costCents: 2450, marginCents: 6550, marginPercent: 72.8 },
      ]);
      // Totais: soma das linhas com ficha; item sem ficha fora do custo e da margem.
      expect(res.body.totals).toMatchObject({ quantity: 8, revenueCents: 23_000, coveredRevenueCents: 15_000, costCents: 5450, marginCents: 9550, marginPercent: 63.7 });
    });

    it('só conta pedidos pagos do período e do próprio estabelecimento (cancelado, não pago e de outra casa ficam fora)', async () => {
      await setup();
      const now = new Date();
      await order(world.itemA.id, 'IPA', 2000, 1, now);
      await order(world.itemA.id, 'IPA', 2000, 5, now, 'cancelled');
      await order(world.itemA.id, 'IPA', 2000, 7, new Date(now.getTime() - 40 * DAY));
      await order(world.itemB.id, 'Pilsen', 1000, 9, now, 'delivered', world.estB.id);
      const day = now.toISOString().slice(0, 10);
      const res = await manager.get(`${est()}/reports/cost?from=${day}&to=${day}`);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0]).toMatchObject({ name: 'IPA', quantity: 1 });
      const wide = await manager.get(`${est()}/reports/cost?from=${new Date(now.getTime() - 60 * DAY).toISOString().slice(0, 10)}&to=${day}`);
      expect(wide.body.rows[0].quantity).toBe(8);
    });

    it('recalcula com o custo atual do insumo e valida o período', async () => {
      await setup();
      await order(world.itemA.id, 'IPA', 2000, 1, new Date());
      const day = new Date().toISOString().slice(0, 10);
      await t.prisma.ingredient.updateMany({ where: { name: 'Queijo' }, data: { unitCost: '80.0000' } });
      expect((await manager.get(`${est()}/reports/cost?from=${day}&to=${day}`)).body.rows[0].costCents).toBe(2000);
      expect((await manager.get(`${est()}/reports/cost?from=${day}&to=2000-01-01`)).body.code).toBe('INVALID_PERIOD');
      expect((await manager.get(`${est()}/reports/cost?from=2020-01-01&to=${day}`)).body.code).toBe('PERIOD_TOO_LONG');
      expect((await manager.get(`${est()}/reports/cost?from=ontem&to=${day}`)).status).toBe(400);
    });

    it('exporta CSV (pt-BR, com total) e PDF', async () => {
      await setup();
      await order(world.itemA.id, 'IPA', 2000, 3, new Date());
      const day = new Date().toISOString().slice(0, 10);
      const csv = await manager.get(`${est()}/reports/cost/export?from=${day}&to=${day}&format=csv`);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.headers['content-disposition']).toContain(`custo-${day}_a_${day}.csv`);
      expect(csv.text.startsWith('﻿Item;Categoria;Quantidade')).toBe(true);
      expect(csv.text).toContain('IPA;Cervejas;3;60,00;30,00;30,00;50');
      expect(csv.text).toContain('Total (itens com ficha);;3;60,00;30,00;30,00;50');
      const pdf = await manager
        .get(`${est()}/reports/cost/export?from=${day}&to=${day}&format=pdf`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('exige permissão e o recurso de fichas técnicas do plano', async () => {
      expect((await attendant.get(`${est()}/reports/cost?from=2026-01-01&to=2026-01-02`)).status).toBe(403);
      const start = await login(t.browser(), world.managerStart.email);
      expect((await start.get(`/api/establishments/${world.estStart.id}/reports/cost?from=2026-01-01&to=2026-01-02`)).status).toBe(403);
    });
  });

  // ─── Ficha 70 ─────────────────────────────────────────────────────────────

  describe('alerta de ingrediente perto do vencimento (70)', () => {
    let lots: IngredientLotsService;
    beforeEach(() => {
      lots = t.app.get(IngredientLotsService);
    });
    const ingredient = () => t.prisma.ingredient.create({ data: { establishmentId: world.estA.id, name: 'Mussarela', unit: 'kg', unitCost: '30.0000' } });
    const alerts = async (agent = manager) => (await agent.get(`${est()}/alerts`)).body as { kind: string; message: string; refId: string }[];

    it('avisa com pelo menos 3 dias de antecedência (padrão 7) e sugere os pratos que usam o insumo', async () => {
      const cheese = await ingredient();
      await t.prisma.technicalSheet.create({ data: { menuItemId: world.itemA.id, costLimitPercent: '50', items: { create: [{ ingredientId: cheese.id, quantity: '0.1' }] } } });
      const created = await manager.post(`${est()}/ingredient-lots`).set(CSRF).send({ ingredientId: cheese.id, code: 'L-001', quantity: 5, expiresOn: '2099-12-20' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ code: 'L-001', ingredientName: 'Mussarela', expiresOn: '2099-12-20', state: 'ok', dishes: [{ name: 'IPA' }] });
      expect(await alerts()).toHaveLength(0);

      await lots.sync(world.estA.id, new Date('2099-12-12T15:00:00Z')); // 8 dias antes: ainda não
      expect(await alerts()).toHaveLength(0);
      await lots.sync(world.estA.id, new Date('2099-12-13T15:00:00Z')); // 7 dias antes: alerta
      const [alert] = await alerts();
      expect(alert?.kind).toBe('ingredient_expiring');
      expect(alert?.message).toContain('vence em 7 dias');
      expect(alert?.message).toContain('Priorize: IPA');
      // O alerta chegou com mais de 3 dias de antecedência do vencimento.
      const listed = await lots.list(world.estA.id, new Date('2099-12-13T15:00:00Z'));
      expect(listed[0]).toMatchObject({ daysLeft: 7, state: 'expiring' });
      expect(listed[0]?.daysLeft).toBeGreaterThanOrEqual(3);
    });

    it('um alerta por lote, mensagem atualizada a cada dia, aviso à equipe uma vez e vencido sinalizado', async () => {
      const cheese = await ingredient();
      await manager.post(`${est()}/ingredient-lots`).set(CSRF).send({ ingredientId: cheese.id, code: 'A', expiresOn: '2099-06-10' });
      await lots.sync(world.estA.id, new Date('2099-06-05T12:00:00Z'));
      await lots.sync(world.estA.id, new Date('2099-06-05T18:00:00Z'));
      expect(await alerts()).toHaveLength(1);
      await lots.sync(world.estA.id, new Date('2099-06-09T12:00:00Z'));
      expect((await alerts())[0]?.message).toContain('vence amanhã');
      await lots.sync(world.estA.id, new Date('2099-06-12T12:00:00Z'));
      expect((await alerts())[0]?.message).toContain('venceu há 2 dias');
      const inbox = (await manager.get(`${est()}/notifications`)).body;
      expect(inbox.items.filter((n: { kind: string }) => n.kind === 'ingredient_expiring')).toHaveLength(1);
      // Atendente não tem a permissão de fichas: não vê o alerta nem o aviso.
      expect(await alerts(attendant)).toHaveLength(0);
      expect((await attendant.get(`${est()}/notifications`)).body.items.filter((n: { kind: string }) => n.kind === 'ingredient_expiring')).toHaveLength(0);
    });

    it('marcar o lote como usado fecha o alerta; antecedência configurável (mínimo 3 dias); código único por insumo', async () => {
      const cheese = await ingredient();
      const lot = (await manager.post(`${est()}/ingredient-lots`).set(CSRF).send({ ingredientId: cheese.id, code: 'B', expiresOn: '2099-03-20' })).body;
      expect((await manager.post(`${est()}/ingredient-lots`).set(CSRF).send({ ingredientId: cheese.id, code: 'B', expiresOn: '2099-03-21' })).body.code).toBe('LOT_EXISTS');
      expect((await manager.put(`${est()}/expiry-settings`).set(CSRF).send({ alertDays: 2 })).status).toBe(400);
      expect((await manager.put(`${est()}/expiry-settings`).set(CSRF).send({ alertDays: 3 })).body).toEqual({ alertDays: 3 });
      await lots.sync(world.estA.id, new Date('2099-03-17T12:00:00Z'));
      expect(await alerts()).toHaveLength(1);
      expect((await manager.post(`${est()}/ingredient-lots/${lot.id}/close`).set(CSRF)).body.state).toBe('closed');
      expect(await alerts()).toHaveLength(0);
      // Fora da antecedência com a configuração nova.
      await t.prisma.ingredientLot.update({ where: { id: lot.id }, data: { closedAt: null } });
      await lots.syncAll(new Date('2099-03-10T12:00:00Z'));
      expect(await alerts()).toHaveLength(0);
    });

    it('lote de outro estabelecimento é isolado; datas inválidas e insumo alheio são recusados', async () => {
      const cheese = await ingredient();
      const lot = (await manager.post(`${est()}/ingredient-lots`).set(CSRF).send({ ingredientId: cheese.id, code: 'C', expiresOn: '2099-03-20' })).body;
      expect((await managerB.post(`/api/establishments/${world.estB.id}/ingredient-lots/${lot.id}/close`).set(CSRF)).status).toBe(404);
      expect((await managerB.post(`/api/establishments/${world.estB.id}/ingredient-lots`).set(CSRF).send({ ingredientId: cheese.id, code: 'X', expiresOn: '2099-03-20' })).status).toBe(422);
      expect((await manager.post(`${est()}/ingredient-lots`).set(CSRF).send({ ingredientId: cheese.id, code: 'D', expiresOn: '2099-02-31' })).status).toBe(422);
      expect((await attendant.get(`${est()}/ingredient-lots`)).status).toBe(403);
      expect((await manager.delete(`${est()}/ingredient-lots/${lot.id}`).set(CSRF)).status).toBe(204);
    });
  });

  // ─── Ficha 66 ─────────────────────────────────────────────────────────────

  describe('histórico de alterações do estabelecimento (66)', () => {
    const history = async (query = '') => (await admin.get(`/api/admin/establishment-changes${query}`)).body;

    it('registra autor, data, campo e os valores antes e depois — só do que mudou', async () => {
      const before = Date.now();
      const res = await admin.patch(`/api/admin/establishments/${world.estA.id}`).set(CSRF).send({ name: 'Bar A Novo', ordersPaused: true, city: 'Campinas' });
      expect(res.status).toBe(200);
      const page = await history();
      expect(page.total).toBe(2); // cidade não mudou: sem registro
      const byField = Object.fromEntries(page.items.map((i: { field: string }) => [i.field, i]));
      expect(byField.name).toMatchObject({ actorName: 'Admin', fieldLabel: 'Nome', oldValue: 'Bar A', newValue: 'Bar A Novo', establishmentName: 'Bar A Novo' });
      expect(byField.ordersPaused).toMatchObject({ oldValue: false, newValue: true });
      expect(new Date(byField.name.createdAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    it('guarda plano, status, horários e fotos com o valor anterior preservado', async () => {
      await admin.put(`/api/admin/establishments/${world.estA.id}/plan`).set(CSRF).send({ planId: world.plans.start.id });
      await admin.patch(`/api/admin/establishments/${world.estA.id}/status`).set(CSRF).send({ status: 'suspended' });
      await admin.patch(`/api/admin/establishments/${world.estA.id}`).set(CSRF).send({ openingHours: [{ weekday: 1, opensAt: '10:00', closesAt: '22:00' }] });
      const { items } = await history(`?establishmentId=${world.estA.id}`);
      const find = (field: string) => items.find((i: { field: string }) => i.field === field);
      expect(find('plan')).toMatchObject({ oldValue: 'Business', newValue: 'Start' });
      expect(find('status')).toMatchObject({ oldValue: 'active', newValue: 'suspended' });
      expect(find('openingHours').oldValue).toHaveLength(7);
      expect(find('openingHours').newValue).toEqual([{ weekday: 1, opensAt: '10:00', closesAt: '22:00' }]);
    });

    it('lista com filtros por estabelecimento, campo, autor e período, paginada e do mais recente ao mais antigo', async () => {
      await admin.patch(`/api/admin/establishments/${world.estA.id}`).set(CSRF).send({ pickupPoint: 'Balcão 9' });
      await admin.patch(`/api/admin/establishments/${world.estB.id}`).set(CSRF).send({ pickupPoint: 'Balcão 7', averageWaitMinutes: 40 });
      expect((await history(`?establishmentId=${world.estB.id}`)).total).toBe(2);
      expect((await history('?field=pickupPoint')).total).toBe(2);
      expect((await history('?q=admin')).total).toBe(3);
      expect((await history('?q=nao-existe')).total).toBe(0);
      const today = new Date().toISOString().slice(0, 10);
      expect((await history(`?from=${today}&to=${today}`)).total).toBeGreaterThanOrEqual(3);
      expect((await history('?from=2020-01-01&to=2020-01-02')).total).toBe(0);
      const page = await history('?pageSize=2');
      expect(page.items).toHaveLength(2);
      expect(page.items[0].createdAt >= page.items[1].createdAt).toBe(true);
      expect((await admin.get('/api/admin/establishment-changes?field=segredo')).status).toBe(400);
    });

    it('é imutável: o banco recusa alterar ou apagar um registro e a API não oferece essas rotas', async () => {
      await admin.patch(`/api/admin/establishments/${world.estA.id}`).set(CSRF).send({ name: 'Outro nome' });
      const [row] = await t.prisma.establishmentChange.findMany();
      await expect(t.prisma.establishmentChange.update({ where: { id: row?.id as string }, data: { newValue: 'x' } })).rejects.toThrow(/imutável/);
      await expect(t.prisma.establishmentChange.delete({ where: { id: row?.id as string } })).rejects.toThrow(/imutável/);
      await expect(t.prisma.establishmentChange.deleteMany()).rejects.toThrow(/imutável/);
      expect((await admin.delete(`/api/admin/establishment-changes/${row?.id}`).set(CSRF)).status).toBe(404);
      expect((await admin.patch(`/api/admin/establishment-changes/${row?.id}`).set(CSRF).send({})).status).toBe(404);
      expect(await t.prisma.establishmentChange.count()).toBe(1);
    });

    it('ignora o que não mudou, registra o cadastro novo e o ajuste do gestor; só quem gerencia estabelecimentos vê', async () => {
      await admin.patch(`/api/admin/establishments/${world.estA.id}`).set(CSRF).send({ name: 'Bar A' });
      expect((await history()).total).toBe(0);
      const org = await t.prisma.organization.findFirstOrThrow();
      const created = await admin.post('/api/admin/establishments').set(CSRF).send({ name: 'Nova Casa', type: 'bar', city: 'Campinas', address: 'Rua Nova, 1', latitude: -22.9, longitude: -47.06, organizationId: org.id, planId: world.plans.business.id });
      expect(created.status).toBe(201);
      expect((await history()).items[0]).toMatchObject({ field: 'created', fieldLabel: 'Cadastro criado', newValue: { name: 'Nova Casa', plan: 'Business' } });
      await manager.put(`${est()}/expiry-settings`).set(CSRF).send({ alertDays: 10 });
      expect((await history(`?establishmentId=${world.estA.id}`)).items[0]).toMatchObject({ field: 'expiryAlertDays', actorName: 'Gestor A', oldValue: 7, newValue: 10 });
      expect((await manager.get('/api/admin/establishment-changes')).status).toBe(403);
      expect((await t.browser().get('/api/admin/establishment-changes')).status).toBe(401);
    });
  });

  // ─── Ficha 39 ─────────────────────────────────────────────────────────────

  describe('central de suporte (39)', () => {
    const open = (agent: Agent, estId: string, subject: string, priority: string, message = 'Preciso de ajuda.') => agent.post(`/api/establishments/${estId}/support/tickets`).set(CSRF).send({ subject, priority, message });

    it('a casa abre chamados e a fila da plataforma sai priorizada por urgência, com status', async () => {
      await open(manager, world.estA.id, 'Dúvida simples', 'low');
      await open(managerB, world.estB.id, 'Sistema fora do ar', 'urgent');
      await open(manager, world.estA.id, 'Erro no relatório', 'high');
      await open(managerB, world.estB.id, 'Pedido duplicado', 'urgent');
      const queue = (await admin.get('/api/admin/support/tickets')).body;
      expect(queue.items.map((i: { subject: string }) => i.subject)).toEqual(['Sistema fora do ar', 'Pedido duplicado', 'Erro no relatório', 'Dúvida simples']); // urgente (mais antigo primeiro), alta, baixa
      expect(queue.items[0]).toMatchObject({ status: 'open', priority: 'urgent', establishmentName: 'Bar B', awaitingPlatform: true, messageCount: 1 });
      expect(queue.counts).toMatchObject({ open: 4, in_progress: 0, resolved: 0, urgentOpen: 2, awaiting: 4 });
      expect((await admin.get('/api/admin/support/tickets?priority=high')).body.items).toHaveLength(1);
    });

    it('o chamado aparece na fila em tempo hábil (segundos) e o admin vê a conversa', async () => {
      const started = Date.now();
      const ticket = (await open(manager, world.estA.id, 'Impressora', 'normal', 'A impressora não imprime.')).body;
      const queue = (await admin.get('/api/admin/support/tickets')).body;
      expect(Date.now() - started).toBeLessThan(60_000);
      expect(queue.items.some((i: { id: string }) => i.id === ticket.id)).toBe(true);
      const detail = (await admin.get(`/api/admin/support/tickets/${ticket.id}`)).body;
      expect(detail.messages).toEqual([expect.objectContaining({ side: 'establishment', authorName: 'Gestor A', body: 'A impressora não imprime.' })]);
    });

    it('cada resposta da plataforma notifica a casa (in-app e e-mail), muda para em andamento e mantém o histórico', async () => {
      const ticket = (await open(manager, world.estA.id, 'Impressora', 'high')).body;
      const reply = await admin.post(`/api/admin/support/tickets/${ticket.id}/messages`).set(CSRF).send({ body: 'Reinicie a impressora, por favor.' });
      expect(reply.status).toBe(201);
      expect(reply.body).toMatchObject({ status: 'in_progress', awaitingPlatform: false });
      expect(reply.body.messages.map((m: { side: string }) => m.side)).toEqual(['establishment', 'platform']);
      await admin.post(`/api/admin/support/tickets/${ticket.id}/messages`).set(CSRF).send({ body: 'Conseguiu?' });

      const inbox = (await manager.get(`${est()}/notifications`)).body;
      const replies = inbox.items.filter((n: { kind: string }) => n.kind === 'support_reply');
      expect(replies).toHaveLength(2); // uma notificação a cada resposta
      expect(replies[1].body).toContain('Reinicie a impressora');
      expect(inbox.unread).toBeGreaterThanOrEqual(2);
      expect(t.email.messages.filter(m => m.destination === 'gestor.a@test.dev')).toHaveLength(0); // e-mail só para contas verificadas
      await t.prisma.user.update({ where: { id: world.managerA.id }, data: { emailVerifiedAt: new Date() } });
      await admin.post(`/api/admin/support/tickets/${ticket.id}/messages`).set(CSRF).send({ body: 'Fico no aguardo.' });
      expect(t.email.messages.some(m => m.destination === 'gestor.a@test.dev' && m.message.includes('Fico no aguardo'))).toBe(true);
      // Atendente (sem permissão de suporte) não recebe o aviso.
      expect((await attendant.get(`${est()}/notifications`)).body.items.filter((n: { kind: string }) => n.kind === 'support_reply')).toHaveLength(0);

      const mine = (await manager.get(`${est()}/support/tickets/${ticket.id}`)).body;
      expect(mine.messages).toHaveLength(4);
      await manager.post(`${est()}/support/tickets/${ticket.id}/messages`).set(CSRF).send({ body: 'Funcionou, obrigado.' });
      expect((await admin.get(`/api/admin/support/tickets/${ticket.id}`)).body).toMatchObject({ awaitingPlatform: true, messageCount: 5 });
    });

    it('resolver tira da fila; resposta da casa reabre; urgência e status podem ser ajustados', async () => {
      const ticket = (await open(manager, world.estA.id, 'Cobrança', 'normal')).body;
      expect((await admin.patch(`/api/admin/support/tickets/${ticket.id}`).set(CSRF).send({ priority: 'urgent' })).body.priority).toBe('urgent');
      expect((await admin.patch(`/api/admin/support/tickets/${ticket.id}`).set(CSRF).send({ status: 'resolved' })).body.status).toBe('resolved');
      expect((await admin.get('/api/admin/support/tickets')).body.items).toHaveLength(0);
      expect((await admin.get('/api/admin/support/tickets?scope=resolved')).body.items).toHaveLength(1);
      await manager.post(`${est()}/support/tickets/${ticket.id}/messages`).set(CSRF).send({ body: 'Voltou a acontecer.' });
      expect((await admin.get('/api/admin/support/tickets')).body.items[0]).toMatchObject({ id: ticket.id, status: 'open' });
      expect((await manager.post(`${est()}/support/tickets/${ticket.id}/resolve`).set(CSRF)).body.status).toBe('resolved');
      expect((await admin.patch(`/api/admin/support/tickets/${ticket.id}`).set(CSRF).send({ status: 'arquivado' })).status).toBe(400);
    });

    it('isolamento e permissões: outra casa não enxerga, atendente e cliente não acessam, admin sem permissão não atende', async () => {
      const ticket = (await open(manager, world.estA.id, 'Segredo', 'low')).body;
      expect((await managerB.get(`/api/establishments/${world.estB.id}/support/tickets/${ticket.id}`)).status).toBe(404);
      expect((await managerB.post(`/api/establishments/${world.estB.id}/support/tickets/${ticket.id}/messages`).set(CSRF).send({ body: 'oi' })).status).toBe(404);
      expect((await managerB.get(`/api/establishments/${world.estB.id}/support/tickets`)).body).toHaveLength(0);
      expect((await attendant.get(`${est()}/support/tickets`)).status).toBe(403);
      expect((await manager.get('/api/admin/support/tickets')).status).toBe(403);
      const limited = await createUser(t.prisma, { name: 'Admin sem suporte', email: 'semsuporte@test.dev', role: 'admin' });
      await t.prisma.userPermission.deleteMany({ where: { userId: limited.id, permission: 'platform.support' } });
      const agent = await login(t.browser(), limited.email);
      expect((await agent.get('/api/admin/support/tickets')).body.code).toBe('MISSING_PERMISSION');
      expect((await open(manager, world.estA.id, 'x', 'low')).status).toBe(400); // assunto curto
      expect((await open(manager, world.estA.id, 'Assunto ok', 'critica')).status).toBe(400);
    });
  });

  // ─── Ficha 33 ─────────────────────────────────────────────────────────────

  describe('monitoramento de incidentes e integrações (33)', () => {
    let monitoring: MonitoringService;
    beforeEach(() => {
      monitoring = t.app.get(MonitoringService);
    });
    const register = async (estId: string, name = 'PDV Caixa 1') => {
      const res = await admin.post('/api/admin/monitoring/integrations').set(CSRF).send({ establishmentId: estId, name, kind: 'pdv' });
      expect(res.status).toBe(201);
      return res.body as { id: string; deviceKey: string };
    };
    const beat = (key: string, body: object = {}) => t.browser().post('/api/integrations/heartbeat').set('X-Integration-Key', key).send(body);

    it('queda do PDV vira incidente em até 1 minuto, com a contagem de estabelecimentos impactados; a volta encerra', async () => {
      const a = await register(world.estA.id);
      const b = await register(world.estB.id, 'PDV Balcão');
      expect((await beat(a.deviceKey)).status).toBe(204);
      expect((await beat(b.deviceKey)).status).toBe(204);
      expect((await admin.get('/api/admin/monitoring')).body).toMatchObject({ impactedEstablishments: 0, activeIncidents: [] });
      expect((await admin.get('/api/admin/monitoring')).body.integrations.map((i: { status: string }) => i.status)).toEqual(['online', 'online']);

      expect(await monitoring.checkOffline(new Date(Date.now() + 20_000))).toBe(0); // 20 s: ainda dentro do prazo
      expect(await monitoring.checkOffline(new Date(Date.now() + 41_000))).toBe(2); // monitor a cada 10 s: detecta em ≤ ~40 s
      const overview = (await admin.get('/api/admin/monitoring')).body;
      expect(overview.impactedEstablishments).toBe(2);
      expect(overview.activeIncidents).toHaveLength(2);
      expect(overview.activeIncidents[0]).toMatchObject({ integrationKind: 'pdv', cause: 'heartbeat_timeout', resolvedAt: null });
      expect(await monitoring.checkOffline(new Date(Date.now() + 120_000))).toBe(0); // sem duplicar

      expect((await beat(a.deviceKey)).status).toBe(204); // PDV da casa A voltou
      const after = (await admin.get('/api/admin/monitoring')).body;
      expect(after.impactedEstablishments).toBe(1);
      expect(after.activeIncidents[0]).toMatchObject({ establishmentName: 'Bar B' });
      const history = (await admin.get('/api/admin/monitoring/incidents')).body;
      expect(history.total).toBe(2);
      expect(history.items.find((i: { establishmentName: string }) => i.establishmentName === 'Bar A').resolvedAt).not.toBeNull();
    });

    it('a integração pode informar a falha na hora; vários incidentes na mesma casa contam uma casa só', async () => {
      const a = await register(world.estA.id);
      const second = await register(world.estA.id, 'ERP');
      await beat(a.deviceKey, { status: 'error', message: 'Banco do PDV inacessível' });
      await beat(second.deviceKey, { status: 'error' });
      await beat(a.deviceKey, { status: 'error', message: 'de novo' }); // não duplica o incidente aberto
      const overview = (await admin.get('/api/admin/monitoring')).body;
      expect(overview.activeIncidents).toHaveLength(2);
      expect(overview.impactedEstablishments).toBe(1);
      expect(overview.activeIncidents.find((i: { integrationName: string }) => i.integrationName === 'PDV Caixa 1')).toMatchObject({ cause: 'reported', message: 'Banco do PDV inacessível' });
      expect((await admin.get('/api/admin/monitoring/incidents?active=true')).body.total).toBe(2);
      await beat(a.deviceKey);
      expect((await admin.get('/api/admin/monitoring/incidents?active=true')).body.total).toBe(1);
      expect((await admin.get(`/api/admin/monitoring/incidents?establishmentId=${world.estB.id}`)).body.total).toBe(0);
    });

    it('integração que nunca deu sinal não gera incidente; chave inválida ou trocada é recusada', async () => {
      const a = await register(world.estA.id);
      expect(await monitoring.checkOffline(new Date(Date.now() + 10 * 60_000))).toBe(0);
      expect((await beat('ik_invalida')).status).toBe(401);
      expect((await t.browser().post('/api/integrations/heartbeat').send({})).status).toBe(401);
      expect((await beat(a.deviceKey, { status: 'talvez' })).status).toBe(400);
      const rotated = (await admin.post(`/api/admin/monitoring/integrations/${a.id}/rotate-key`).set(CSRF)).body;
      expect(rotated.deviceKey).not.toBe(a.deviceKey);
      expect((await beat(a.deviceKey)).status).toBe(401);
      expect((await beat(rotated.deviceKey)).status).toBe(204);
      expect(JSON.stringify((await admin.get('/api/admin/monitoring')).body)).not.toContain(rotated.deviceKey);
    });

    it('o histórico é de auditoria: não se apaga nem se reescreve; integração com histórico não é removida', async () => {
      const a = await register(world.estA.id);
      await beat(a.deviceKey, { status: 'error', message: 'Falha' });
      const incident = await t.prisma.incident.findFirstOrThrow();
      await expect(t.prisma.incident.delete({ where: { id: incident.id } })).rejects.toThrow(/não pode ser apagado/);
      await expect(t.prisma.incident.update({ where: { id: incident.id }, data: { message: 'adulterado' } })).rejects.toThrow(/só pode ser encerrado/);
      await expect(t.prisma.incident.update({ where: { id: incident.id }, data: { startedAt: new Date(0) } })).rejects.toThrow(/só pode ser encerrado/);
      await t.prisma.incident.update({ where: { id: incident.id }, data: { resolvedAt: new Date() } }); // encerrar é permitido
      await expect(t.prisma.incident.update({ where: { id: incident.id }, data: { resolvedAt: null } })).rejects.toThrow(/só pode ser encerrado/);
      expect((await admin.delete(`/api/admin/monitoring/integrations/${a.id}`).set(CSRF)).body.code).toBe('INTEGRATION_HAS_HISTORY');
      const fresh = await register(world.estB.id, 'PDV novo');
      expect((await admin.delete(`/api/admin/monitoring/integrations/${fresh.id}`).set(CSRF)).status).toBe(204);
    });

    it('só a plataforma com a permissão de monitoramento acessa; nomes repetidos e casa inexistente são recusados', async () => {
      expect((await manager.get('/api/admin/monitoring')).status).toBe(403);
      expect((await t.browser().get('/api/admin/monitoring')).status).toBe(401);
      await register(world.estA.id);
      expect((await admin.post('/api/admin/monitoring/integrations').set(CSRF).send({ establishmentId: world.estA.id, name: 'PDV Caixa 1', kind: 'pdv' })).status).toBe(409);
      expect((await admin.post('/api/admin/monitoring/integrations').set(CSRF).send({ establishmentId: '5b0f1e0e-6d62-4f9a-9a58-0c5c5b0b9b11', name: 'X1', kind: 'pdv' })).status).toBe(422);
      expect((await admin.post('/api/admin/monitoring/integrations').set(CSRF).send({ establishmentId: world.estA.id, name: 'X1', kind: 'drone' })).status).toBe(400);
    });
  });

  // ─── Ficha 38 ─────────────────────────────────────────────────────────────

  describe('pagamentos da plataforma (38)', () => {
    let billing: BillingService;
    beforeEach(() => {
      billing = t.app.get(BillingService);
    });
    const invoices = async (query = '') => (await admin.get(`/api/admin/invoices${query}`)).body;

    it('gera a fatura do mês para cada casa ativa (uma por mês, idempotente) e a casa a vê', async () => {
      const now = new Date('2026-11-05T15:00:00Z');
      expect(await billing.runCycle(now)).toEqual({ generated: 3, markedOverdue: 0, notified: 0 });
      expect(await billing.runCycle(now)).toEqual({ generated: 0, markedOverdue: 0, notified: 0 });
      const page = await invoices();
      expect(page.total).toBe(3);
      expect(page.items.find((i: { establishmentName: string }) => i.establishmentName === 'Bar A')).toMatchObject({ period: '2026-11', planName: 'Business', amountCents: 79_900, dueDate: '2026-11-10', status: 'pending' });
      expect(page.counts).toMatchObject({ all: 3, pending: 3, paid: 0, overdue: 0 });
      const mine = (await manager.get(`${est()}/invoices`)).body;
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ period: '2026-11', status: 'pending' });
      expect((await managerB.get(`${est()}/invoices`)).status).toBe(403); // outra casa
      expect((await attendant.get(`${est()}/invoices`)).status).toBe(403);
      const inbox = (await manager.get(`${est()}/notifications`)).body.items.map((n: { kind: string }) => n.kind);
      expect(inbox).toContain('invoice_issued');
      expect(await billing.runCycle(new Date('2026-12-02T12:00:00Z'))).toMatchObject({ generated: 3 }); // mês seguinte
    });

    it('fatura vencida muda sozinha para "atrasado" e avisa a casa no dia seguinte, sem repetir no mesmo dia', async () => {
      await billing.runCycle(new Date('2026-11-05T15:00:00Z'));
      // No dia do vencimento (até 23h59 de Brasília) ainda não está atrasada.
      expect(await billing.runCycle(new Date('2026-11-11T01:00:00Z'))).toMatchObject({ markedOverdue: 0, notified: 0 });
      expect((await invoices('?status=pending')).total).toBe(3);

      const nextDay = new Date('2026-11-11T12:00:00Z');
      expect(await billing.runCycle(nextDay)).toEqual({ generated: 0, markedOverdue: 3, notified: 3 });
      const late = await invoices('?status=overdue');
      expect(late.total).toBe(3);
      expect(late.overdueCents).toBe(79_900 * 2 + 9_900);
      expect(late.items[0].status).toBe('overdue');
      const notice = (await manager.get(`${est()}/notifications`)).body.items.find((n: { kind: string }) => n.kind === 'invoice_overdue');
      expect(notice).toMatchObject({ title: 'Fatura 11/2026 em atraso' });
      expect(notice.body).toContain('venceu em 10/11/2026');

      expect(await billing.runCycle(new Date('2026-11-11T20:00:00Z'))).toMatchObject({ markedOverdue: 0, notified: 0 }); // mesmo dia
      expect(await billing.runCycle(new Date('2026-11-14T13:00:00Z'))).toMatchObject({ notified: 3 }); // lembrete após 3 dias
    });

    it('a leitura já mostra a pendente vencida como atrasada, mesmo antes da rotina rodar', async () => {
      await billing.runCycle(new Date('2026-11-05T15:00:00Z'));
      const asOf = await billing.list({ page: 1, pageSize: 20, status: undefined }, new Date('2026-11-12T12:00:00Z'));
      expect(asOf.items.every(item => item.status === 'overdue')).toBe(true);
      expect(asOf.counts.overdue).toBe(3);
    });

    it('registrar o pagamento encerra a pendência e os avisos; não paga duas vezes; cancelar só pendente/atrasada', async () => {
      await billing.runCycle(new Date('2026-11-05T15:00:00Z'));
      await billing.runCycle(new Date('2026-11-11T12:00:00Z'));
      const mine = (await invoices(`?establishmentId=${world.estA.id}`)).items[0];
      const paid = await admin.post(`/api/admin/invoices/${mine.id}/pay`).set(CSRF).send({ note: 'PIX confirmado' });
      expect(paid.status).toBe(200);
      expect(paid.body).toMatchObject({ status: 'paid', paymentNote: 'PIX confirmado' });
      expect(paid.body.paidAt).not.toBeNull();
      expect((await admin.post(`/api/admin/invoices/${mine.id}/pay`).set(CSRF).send({})).body.code).toBe('INVOICE_NOT_PAYABLE');
      expect((await admin.post(`/api/admin/invoices/${mine.id}/cancel`).set(CSRF)).status).toBe(409);
      expect(await billing.runCycle(new Date('2026-11-20T12:00:00Z'))).toMatchObject({ notified: 2 }); // só as outras duas
      const other = (await invoices(`?establishmentId=${world.estB.id}`)).items[0];
      expect((await admin.post(`/api/admin/invoices/${other.id}/cancel`).set(CSRF)).body.status).toBe('cancelled');
      expect((await invoices()).counts).toMatchObject({ all: 3, paid: 1, cancelled: 1, overdue: 1 });
      expect((await admin.post('/api/admin/invoices/5b0f1e0e-6d62-4f9a-9a58-0c5c5b0b9b11/pay').set(CSRF).send({})).status).toBe(404);
    });

    it('não cobra casa inativa nem plano gratuito, nem gera fatura já vencida para casa recém-cadastrada', async () => {
      await t.prisma.establishment.update({ where: { id: world.estB.id }, data: { status: 'inactive' } });
      await t.prisma.plan.update({ where: { id: world.plans.start.id }, data: { monthlyPriceCents: 0 } });
      expect(await billing.runCycle(new Date('2026-11-05T15:00:00Z'))).toMatchObject({ generated: 1 });
      await t.prisma.establishment.update({ where: { id: world.estB.id }, data: { status: 'active', createdAt: new Date('2026-11-20T12:00:00Z') } });
      expect(await billing.runCycle(new Date('2026-11-25T12:00:00Z'))).toMatchObject({ generated: 0 }); // criada depois do vencimento: cobra só em dezembro
      expect(await billing.runCycle(new Date('2026-12-03T12:00:00Z'))).toMatchObject({ generated: 2 });
    });

    it('filtros por status, casa, mês e busca; só a plataforma com permissão de cobrança acessa', async () => {
      await billing.runCycle(new Date('2026-11-05T15:00:00Z'));
      await billing.runCycle(new Date('2026-12-03T12:00:00Z'));
      expect((await invoices('?period=2026-12')).total).toBe(3);
      expect((await invoices('?q=Start')).total).toBe(2);
      expect((await invoices('?status=paid')).total).toBe(0);
      expect((await invoices('?pageSize=2')).items).toHaveLength(2);
      expect((await admin.get('/api/admin/invoices?status=quitada')).status).toBe(400);
      expect((await manager.get('/api/admin/invoices')).status).toBe(403);
      expect((await admin.post('/api/admin/billing/run').set(CSRF)).body).toMatchObject({ generated: expect.any(Number) });
    });
  });
});
