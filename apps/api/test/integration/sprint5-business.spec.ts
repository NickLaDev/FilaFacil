import { prorationFor } from '@filafacil/shared';
import { BillingService } from '../../src/modules/billing/billing.service.js';
import { CampaignsService } from '../../src/modules/campaigns/campaigns.service.js';
import { monthPosition } from '../../src/modules/plans/plan-change.service.js';
import { SettingsService } from '../../src/modules/settings/settings.service.js';
import { resetDatabase } from '../helpers/database.js';
import { createWorld, login, type World } from '../helpers/fixtures.js';
import { createOrdersWorld, seedOrder } from '../helpers/orders.js';
import { createTestApp, CSRF, type Agent, type TestApp } from '../helpers/test-app.js';

const DAY = 86_400_000;
const VALID_CNPJ = '11.222.333/0001-81';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const spDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

describe('Sprint 5 — gestor e parceiros (fichas 54, 55, 58, 68, 69)', () => {
  let t: TestApp;
  let world: World;
  let orders: Awaited<ReturnType<typeof createOrdersWorld>>;
  let admin: Agent;
  let manager: Agent;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    world = await createWorld(t.prisma);
    orders = await createOrdersWorld(t.prisma, world);
    t.app.get(SettingsService).invalidate();
    admin = await login(t.browser(), world.admin.email);
    manager = await login(t.browser(), world.managerA.email);
    t.email.messages.length = 0;
  });

  // ─── Ficha 54 ─────────────────────────────────────────────────────────────

  describe('importar cardápio em massa (54)', () => {
    const upload = (agent: Agent, csv: string, dryRun = false) =>
      agent
        .post(`/api/establishments/${world.estA.id}/menu/import`)
        .set(CSRF)
        .field('dryRun', String(dryRun))
        .attach('file', Buffer.from(csv, 'utf8'), { filename: 'cardapio.csv', contentType: 'text/csv' });

    it('baixa o modelo; importa 50 itens em menos de 1 minuto com relatório claro', async () => {
      const template = await manager.get(`/api/establishments/${world.estA.id}/menu/import/template`);
      expect(template.headers['content-type']).toContain('text/csv');
      expect(template.text).toContain('nome;descricao;categoria;preco;disponivel;alergenos;estacao');

      const lines = ['nome;descricao;categoria;preco;disponivel;alergenos;estacao'];
      for (let i = 1; i <= 50; i++) lines.push(`Item ${i};Descrição ${i};${i % 2 ? 'Petiscos' : 'Drinks'};${10 + i},90;${i % 10 === 0 ? 'não' : 'sim'};${i % 5 === 0 ? 'Glúten, Ovo' : ''};`);
      const started = Date.now();
      const res = await upload(manager, lines.join('\n'));
      expect(Date.now() - started).toBeLessThan(60_000);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ dryRun: false, total: 50, created: 50, updated: 0, failed: 0, errorCsv: null });
      expect(res.body.rows).toHaveLength(50);
      const items = (await manager.get(`/api/establishments/${world.estA.id}/menu/items`)).body as { name: string; priceCents: number; available: boolean; allergens: string[]; category: string }[];
      expect(items).toHaveLength(51);
      expect(items.find(item => item.name === 'Item 10')).toMatchObject({ priceCents: 2090, available: false, allergens: ['gluten', 'egg'], category: 'Drinks' });
      expect((await admin.get('/api/admin/audit?action=menu.imported')).body.items[0].summary).toContain('50 criado(s)');
    });

    it('valida obrigatórios, importa as linhas boas e devolve a planilha de erros para corrigir e reimportar', async () => {
      const csv = [
        'nome,categoria,preco,disponivel,alergenos,estacao',
        'IPA,Cervejas,"22,50",sim,,', // já existe: atualiza o preço
        ',Cervejas,10,sim,,', // sem nome
        'Porção,Petiscos,abc,sim,,', // preço inválido
        'Caipirinha,Drinks,18,talvez,leite de cabra,Bar', // disponível, alérgeno e estação inválidos
        'Porção de fritas,Petiscos,30,sim,,',
        'porção de fritas,petiscos,31,sim,,', // repetido na planilha
      ].join('\r\n');
      const preview = await upload(manager, csv, true);
      expect(preview.body).toMatchObject({ dryRun: true, total: 6, created: 0, updated: 0, failed: 4 });
      expect((await manager.get(`/api/establishments/${world.estA.id}/menu/items`)).body).toHaveLength(1); // nada gravado

      const res = await upload(manager, csv);
      expect(res.body).toMatchObject({ total: 6, created: 1, updated: 1, failed: 4 });
      const byLine = Object.fromEntries((res.body.rows as { line: number; status: string; errors: string[] }[]).map(row => [row.line, row]));
      expect(byLine[2]).toMatchObject({ status: 'updated', errors: [] });
      expect(byLine[3].errors).toEqual(['Nome é obrigatório.']);
      expect(byLine[4].errors[0]).toContain('Preço inválido');
      expect(byLine[5].errors).toHaveLength(3);
      expect(byLine[7].errors[0]).toContain('linha 6');
      expect(res.body.errorCsv).toContain('erro');
      expect(res.body.errorCsv).toContain('Nome é obrigatório.');
      expect((await manager.get(`/api/establishments/${world.estA.id}/menu/items`)).body.find((item: { name: string }) => item.name === 'IPA').priceCents).toBe(2250);

      // Corrige a planilha de erros e reimporta: só as linhas corrigidas entram, nada duplica.
      const fixed = (res.body.errorCsv as string)
        .replace(/^\uFEFF/, '')
        .replace(';;Cervejas;10;', 'Session IPA;;Cervejas;10;')
        .replace('Porção;;Petiscos;abc', 'Porção;;Petiscos;25')
        .replace('talvez', 'sim')
        .replace('leite de cabra', 'Leite e lactose')
        .replace(';Bar;', ';;')
        .replace('porção de fritas;;petiscos;31', 'Porção de fritas;;Petiscos;31');
      const again = await upload(manager, fixed);
      expect(again.body.rows.filter((r: { errors: string[] }) => r.errors.length)).toEqual([]);
      expect(again.body).toMatchObject({ failed: 0, created: 3, updated: 1 });
      const names = (await manager.get(`/api/establishments/${world.estA.id}/menu/items`)).body.map((item: { name: string }) => item.name).sort();
      expect(names).toEqual(['Caipirinha', 'IPA', 'Porção', 'Porção de fritas', 'Session IPA']);
    });

    it('recusa planilha sem as colunas obrigatórias, acima do limite ou fora de CSV; respeita permissão e flag', async () => {
      expect((await upload(manager, 'produto;valor\nX;1')).body.code).toBe('INVALID_SPREADSHEET');
      await admin.put('/api/admin/settings/menuImport.maxRows').set(CSRF).send({ value: 10 });
      const many = ['nome;categoria;preco', ...Array.from({ length: 11 }, (_, i) => `I${i};C;1`)].join('\n');
      expect((await upload(manager, many)).body.message).toContain('limite é 10');
      const png = await manager.post(`/api/establishments/${world.estA.id}/menu/import`).set(CSRF).attach('file', Buffer.from([0x89, 0x50]), { filename: 'foto.png', contentType: 'image/png' });
      expect(png.body.code).toBe('UNSUPPORTED_SPREADSHEET');
      const attendant = await login(t.browser(), world.attendantA.email);
      expect((await upload(attendant, 'nome;categoria;preco\nX;C;1')).status).toBe(403);
      await admin.put('/api/admin/settings/features.menuImport').set(CSRF).send({ value: false });
      t.app.get(SettingsService).invalidate();
      expect((await upload(manager, 'nome;categoria;preco\nX;C;1')).body.code).toBe('FEATURE_DISABLED');
    });
  });

  // ─── Ficha 55 ─────────────────────────────────────────────────────────────

  describe('aprovação de novo parceiro (55)', () => {
    const form = (overrides: object = {}) => ({
      businessName: 'Cantina Nova',
      type: 'restaurant',
      document: VALID_CNPJ,
      city: 'Campinas',
      address: 'Rua Nova, 100',
      latitude: -22.9,
      longitude: -47.06,
      opensAt: '00:00',
      closesAt: '23:59',
      contactName: 'Paula Dona',
      contactEmail: 'Paula@Cantina.dev',
      contactPhone: '(19) 98888-7777',
      ...overrides,
    });
    const apply = async (overrides: object = {}) => {
      const res = await t.browser().post('/api/partner-applications').set(CSRF).send(form(overrides));
      expect(res.status).toBe(201);
      return res.body as { application: { id: string; number: number }; trackingToken: string };
    };

    it('aprovado aceita pedidos na hora: cria rede, estabelecimento ativo e conta de gestor; parceiro é avisado', async () => {
      const { application, trackingToken } = await apply();
      const partner = t.browser();
      const withDoc = await partner.post('/api/partner-applications/mine/documents').set(CSRF).set('X-Partner-Token', trackingToken).attach('file', PDF, { filename: 'contrato social.pdf', contentType: 'application/pdf' });
      expect(withDoc.body.documents).toHaveLength(1);
      expect(t.email.messages.some(m => m.destination === 'paula@cantina.dev' && m.message.includes('recebemos'))).toBe(true);

      // Fila do admin com dados e documentos.
      const queue = (await admin.get('/api/admin/partner-applications?status=pending')).body;
      expect(queue.counts).toMatchObject({ pending: 1, approved: 0 });
      expect(queue.items[0]).toMatchObject({ businessName: 'Cantina Nova', document: '11222333000181', contactPhone: '19988887777', contactEmail: 'paula@cantina.dev', opensAt: '00:00', closesAt: '23:59' });
      const doc = await admin.get(`/api/admin/partner-applications/${application.id}/documents/${queue.items[0].documents[0].id}`).buffer(true);
      expect(doc.headers['content-type']).toContain('application/pdf');
      expect(doc.headers['content-disposition']).toContain('attachment');
      expect((await manager.get(`/api/admin/partner-applications/${application.id}`)).status).toBe(403);

      const approved = await admin.post(`/api/admin/partner-applications/${application.id}/approve`).set(CSRF).send({ planId: world.plans.business.id });
      expect(approved.body).toMatchObject({ status: 'approved' });
      const establishmentId = approved.body.establishmentId as string;
      const restaurant = (await t.browser().get(`/api/restaurants/${establishmentId}`)).body;
      expect(restaurant.name).toBe('Cantina Nova');
      expect(['open', 'busy']).toContain(restaurant.orderingStatus);

      const owner = await t.prisma.user.findUniqueOrThrow({ where: { email: 'paula@cantina.dev' }, include: { memberships: true, organizationRoles: true, permissions: true } });
      expect(owner).toMatchObject({ role: 'manager', name: 'Paula Dona' });
      expect(owner.memberships.map(m => m.establishmentId)).toEqual([establishmentId]);
      expect(owner.organizationRoles[0]?.role).toBe('admin');
      expect(owner.permissions.map(p => p.permission)).toContain('menu.edit');
      expect(await t.prisma.appNotification.count({ where: { userId: owner.id, kind: 'partner_approved' } })).toBe(1);
      expect(t.email.messages.some(m => m.destination === 'paula@cantina.dev' && m.message.includes('já pode receber pedidos'))).toBe(true);
      expect((await partner.get('/api/partner-applications/mine').set('X-Partner-Token', trackingToken)).body.status).toBe('approved');
      expect((await admin.get('/api/admin/audit?action=partner.approved')).body.total).toBe(1);
      expect((await admin.post(`/api/admin/partner-applications/${application.id}/reject`).set(CSRF).send({ message: 'Tarde demais para recusar.' })).body.code).toBe('APPLICATION_CLOSED');
    });

    it('pedir mais informações, parceiro corrige e volta à fila; recusado recebe o motivo', async () => {
      const { application, trackingToken } = await apply();
      const asked = await admin.post(`/api/admin/partner-applications/${application.id}/request-info`).set(CSRF).send({ message: 'Envie o alvará de funcionamento.' });
      expect(asked.body).toMatchObject({ status: 'needs_info', infoRequest: 'Envie o alvará de funcionamento.' });
      expect(t.email.messages.at(-1)?.message).toContain('alvará');
      const partner = t.browser();
      expect((await partner.get('/api/partner-applications/mine').set('X-Partner-Token', trackingToken)).body.infoRequest).toContain('alvará');
      const answered = await partner.patch('/api/partner-applications/mine').set(CSRF).set('X-Partner-Token', trackingToken).send({ notes: 'Alvará anexado.' });
      expect(answered.body).toMatchObject({ status: 'pending', notes: 'Alvará anexado.' });

      expect((await admin.post(`/api/admin/partner-applications/${application.id}/reject`).set(CSRF).send({ message: 'curto' })).status).toBe(400);
      const rejected = await admin.post(`/api/admin/partner-applications/${application.id}/reject`).set(CSRF).send({ message: 'Endereço fora da área atendida.' });
      expect(rejected.body).toMatchObject({ status: 'rejected', decisionReason: 'Endereço fora da área atendida.', establishmentId: null });
      expect(t.email.messages.at(-1)).toMatchObject({ destination: 'paula@cantina.dev' });
      expect(t.email.messages.at(-1)?.message).toContain('Motivo: Endereço fora da área atendida.');
      expect((await partner.get('/api/partner-applications/mine').set('X-Partner-Token', trackingToken)).body.decisionReason).toBe('Endereço fora da área atendida.');
      expect((await partner.patch('/api/partner-applications/mine').set(CSRF).set('X-Partner-Token', trackingToken).send({ notes: 'x' })).body.code).toBe('APPLICATION_CLOSED');
      // Recusado: pode mandar um cadastro novo.
      await apply();
    });

    it('valida CNPJ, duplicidade, documentos e código de acompanhamento', async () => {
      expect((await t.browser().post('/api/partner-applications').set(CSRF).send(form({ document: '11.222.333/0001-82' }))).body.code).toBe('INVALID_DOCUMENT');
      expect((await t.browser().post('/api/partner-applications').set(CSRF).send(form({ contactPhone: '123' }))).status).toBe(400);
      const { trackingToken } = await apply();
      expect((await t.browser().post('/api/partner-applications').set(CSRF).send(form())).body.code).toBe('APPLICATION_EXISTS');
      expect((await t.browser().get('/api/partner-applications/mine').set('X-Partner-Token', 'x'.repeat(32))).status).toBe(401);
      const fake = await t.browser().post('/api/partner-applications/mine/documents').set(CSRF).set('X-Partner-Token', trackingToken).attach('file', Buffer.from('MZ executável'), { filename: 'doc.pdf', contentType: 'application/pdf' });
      expect(fake.body.code).toBe('UNSUPPORTED_DOCUMENT');
      // O documento não fica na pasta pública de uploads.
      const stored = await t.prisma.partnerDocument.findMany();
      expect(stored).toHaveLength(0);
      await admin.put('/api/admin/settings/features.partnerSignup').set(CSRF).send({ value: false });
      t.app.get(SettingsService).invalidate();
      expect((await t.browser().post('/api/partner-applications').set(CSRF).send(form({ document: '45.723.174/0001-10' }))).body.code).toBe('FEATURE_DISABLED');
    });

    it('cliente existente com o mesmo e-mail vira gestor da nova casa', async () => {
      const { application } = await apply({ contactEmail: world.client.email, document: '45.723.174/0001-10' });
      await admin.post(`/api/admin/partner-applications/${application.id}/approve`).set(CSRF).send({ planId: world.plans.start.id });
      const user = await t.prisma.user.findUniqueOrThrow({ where: { id: world.client.id }, include: { memberships: true } });
      expect(user.role).toBe('manager');
      expect(user.memberships).toHaveLength(1);
      const agent = await login(t.browser(), world.client.email);
      expect((await agent.get(`/api/establishments/${user.memberships[0]?.establishmentId}/menu/items`)).status).toBe(200);
    });
  });

  // ─── Fichas 58 e 69 ───────────────────────────────────────────────────────

  describe('planos: comparativo (69) e troca self-service (58)', () => {
    const monthlyInvoice = (establishmentId: string, amountCents: number, planName: string) =>
      t.prisma.invoice.create({ data: { establishmentId, period: spDate(new Date()).slice(0, 7), planName, amountCents, dueDate: new Date(`${spDate(new Date()).slice(0, 7)}-10T00:00:00Z`), status: 'paid' } });

    it('mostra os planos lado a lado com o atual destacado, recursos e o valor proporcional da troca', async () => {
      const managerStart = await login(t.browser(), world.managerStart.email);
      await monthlyInvoice(world.estStart.id, 9900, 'Start');
      const res = await managerStart.get(`/api/establishments/${world.estStart.id}/plan/options`);
      expect(res.status).toBe(200);
      const { remainingDays, daysInMonth } = monthPosition(new Date());
      expect(res.body).toMatchObject({ currentPlanId: world.plans.start.id, remainingDays, daysInMonth });
      expect(res.body.plans.map((plan: { name: string }) => plan.name)).toEqual(['Start', 'Business']);
      const [start, business] = res.body.plans;
      expect(start).toMatchObject({ current: true, prorationCents: 0, features: ['floor_plan', 'waitlist'], limits: { units: 1, tables: 3, staff: 5 } });
      expect(business).toMatchObject({ current: false, prorationCents: prorationFor(9900, 79900, remainingDays, daysInMonth), blockers: [] });
      expect(business.features).toContain('promotions');
      // Downgrade de uma casa da rede (3 unidades) para o Start (1 unidade) aparece bloqueado com o motivo.
      const fromA = (await manager.get(`/api/establishments/${world.estA.id}/plan/options`)).body;
      expect(fromA.plans.find((plan: { name: string }) => plan.name === 'Start').blockers).toEqual(['Sua rede tem 3 unidades e o plano Start permite 1.']);
      expect((await manager.post(`/api/establishments/${world.estA.id}/plan/change`).set(CSRF).send({ planId: world.plans.start.id })).body.code).toBe('PLAN_LIMIT_EXCEEDED');
    });

    it('upgrade libera recursos na hora e gera cobrança proporcional correta; confirmação por e-mail', async () => {
      const managerStart = await login(t.browser(), world.managerStart.email);
      await t.prisma.user.update({ where: { id: world.managerStart.id }, data: { emailVerifiedAt: new Date() } });
      await monthlyInvoice(world.estStart.id, 9900, 'Start');
      const blocked = await managerStart.get(`/api/establishments/${world.estStart.id}/coupons`);
      expect(blocked.status).toBe(403); // promoções não fazem parte do Start
      const { remainingDays, daysInMonth } = monthPosition(new Date());
      const expected = prorationFor(9900, 79900, remainingDays, daysInMonth);
      const started = Date.now();
      const res = await managerStart.post(`/api/establishments/${world.estStart.id}/plan/change`).set(CSRF).send({ planId: world.plans.business.id });
      expect(res.body).toMatchObject({ planName: 'Business', prorationCents: expected });
      expect((await managerStart.get(`/api/establishments/${world.estStart.id}/coupons`)).status).toBe(200);
      expect(Date.now() - started).toBeLessThan(60_000);
      const invoice = await t.prisma.invoice.findUniqueOrThrow({ where: { id: res.body.invoiceId } });
      expect(invoice).toMatchObject({ kind: 'proration', amountCents: expected, status: 'pending', planName: 'Business' });
      expect(t.email.messages.some(m => m.destination === 'gestor.start@test.dev' && m.message.includes('Business'))).toBe(true);
      expect((await managerStart.get(`/api/establishments/${world.estStart.id}/plan`)).body.name).toBe('Business');
      expect((await admin.get(`/api/admin/establishment-changes?establishmentId=${world.estStart.id}`)).body.items[0]).toMatchObject({ field: 'plan', oldValue: 'Start', newValue: 'Business' });
      expect((await admin.get('/api/admin/audit?action=plan.self_service_change')).body.total).toBe(1);
      expect((await managerStart.post(`/api/establishments/${world.estStart.id}/plan/change`).set(CSRF).send({ planId: world.plans.business.id })).body.code).toBe('SAME_PLAN');
    });

    it('downgrade gera crédito abatido na próxima mensalidade; sem mensalidade no mês, nada proporcional', async () => {
      const solo = await t.prisma.organization.create({ data: { name: 'Solo' } });
      await t.prisma.establishment.update({ where: { id: world.estB.id }, data: { organizationId: solo.id } });
      const managerB = await login(t.browser(), world.managerB.email);
      // Sem mensalidade emitida no mês: a troca não gera cobrança nem crédito.
      const free = (await managerB.get(`/api/establishments/${world.estB.id}/plan/options`)).body;
      expect(free.plans.every((plan: { prorationCents: number }) => plan.prorationCents === 0)).toBe(true);

      await monthlyInvoice(world.estB.id, 79900, 'Business');
      const { remainingDays, daysInMonth } = monthPosition(new Date());
      const credit = prorationFor(79900, 9900, remainingDays, daysInMonth);
      const res = await managerB.post(`/api/establishments/${world.estB.id}/plan/change`).set(CSRF).send({ planId: world.plans.start.id });
      expect(res.body.prorationCents).toBe(credit);
      expect(credit).toBeLessThan(0);
      expect(await t.prisma.invoice.findUniqueOrThrow({ where: { id: res.body.invoiceId } })).toMatchObject({ kind: 'credit', amountCents: credit, status: 'pending' });
      expect((await managerB.get(`/api/establishments/${world.estB.id}/floor-plan`)).status).toBe(200);
      expect((await managerB.get(`/api/establishments/${world.estB.id}/coupons`)).status).toBe(403); // recurso saiu na hora

      // Mês seguinte: a mensalidade do Start desconta o crédito (sem ficar negativa; o resto segue como crédito).
      const nextMonth = new Date(Date.now() + 35 * DAY);
      nextMonth.setUTCDate(1);
      nextMonth.setUTCHours(15);
      await t.app.get(BillingService).generate(nextMonth);
      const monthly = await t.prisma.invoice.findFirstOrThrow({ where: { establishmentId: world.estB.id, kind: 'monthly', period: spDate(nextMonth).slice(0, 7) } });
      const remaining = Math.max(0, 9900 + credit);
      expect(monthly.amountCents).toBe(remaining);
      const credits = await t.prisma.invoice.findMany({ where: { establishmentId: world.estB.id, kind: 'credit' }, orderBy: { createdAt: 'asc' } });
      expect(credits[0]).toMatchObject({ status: 'paid' });
      const leftover = credits.filter(row => row.status === 'pending').reduce((sum, row) => sum + row.amountCents, 0);
      expect(-leftover).toBe(Math.max(0, -credit - 9900));
      expect((await admin.post(`/api/admin/invoices/${credits[0]?.id}/pay`).set(CSRF).send({})).status).toBeGreaterThanOrEqual(400);
    });

    it('troca respeita permissão e a flag de configuração', async () => {
      const attendant = await login(t.browser(), world.attendantA.email);
      expect((await attendant.post(`/api/establishments/${world.estA.id}/plan/change`).set(CSRF).send({ planId: world.plans.start.id })).status).toBe(403);
      await admin.put('/api/admin/settings/features.planSelfService').set(CSRF).send({ value: false });
      t.app.get(SettingsService).invalidate();
      const managerStart = await login(t.browser(), world.managerStart.email);
      expect((await managerStart.post(`/api/establishments/${world.estStart.id}/plan/change`).set(CSRF).send({ planId: world.plans.business.id })).body.code).toBe('FEATURE_DISABLED');
    });
  });

  // ─── Ficha 68 ─────────────────────────────────────────────────────────────

  describe('promoção segmentada (68)', () => {
    const campaigns = () => t.app.get(CampaignsService);
    const buy = (userId: string, paidAt: Date) => seedOrder(t.prisma, { userId, establishmentId: world.estA.id, status: 'delivered', paidAt, items: [{ menuItemId: world.itemA.id, name: 'IPA', unitPriceCents: 2000 }] });
    const birthday = (date: Date) => new Date(`1990-${spDate(date).slice(5)}T00:00:00Z`);

    it('aniversário chega automaticamente no dia certo, sem disparo manual, uma vez por ano', async () => {
      const now = new Date();
      await t.prisma.user.update({ where: { id: world.client.id }, data: { birthDate: birthday(now) } });
      await t.prisma.user.update({ where: { id: orders.otherClient.id }, data: { birthDate: birthday(new Date(now.getTime() + DAY)) } });
      await buy(world.client.id, new Date(now.getTime() - 10 * DAY));
      await buy(orders.otherClient.id, new Date(now.getTime() - 10 * DAY));

      const created = await manager.post(`/api/establishments/${world.estA.id}/campaigns`).set(CSRF).send({ name: 'Niver', segment: 'birthday', discountType: 'percent', discountValue: 20, validDays: 7, message: 'Parabéns!' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ segment: 'birthday', sent: 1, eligibleNow: 1, used: 0, usageRate: 0 });
      const notice = await t.prisma.appNotification.findFirstOrThrow({ where: { userId: world.client.id, kind: 'campaign_offer' } });
      expect(notice.title).toContain('Feliz aniversário');
      expect(notice.body).toMatch(/Parabéns! Use o cupom NIVER-[A-Z0-9]{6} e ganhe 20% de desconto/);

      // Rotina automática: hoje não manda de novo; amanhã é o aniversário do outro cliente.
      expect(await campaigns().dispatch(now)).toBe(0);
      expect(await t.prisma.appNotification.count({ where: { userId: orders.otherClient.id, kind: 'campaign_offer' } })).toBe(0);
      expect(await campaigns().dispatch(new Date(now.getTime() + DAY))).toBe(1);
      expect(await t.prisma.appNotification.count({ where: { userId: orders.otherClient.id, kind: 'campaign_offer' } })).toBe(1);
      expect(await campaigns().dispatch(new Date(now.getTime() + DAY))).toBe(0);

      // O cupom é pessoal: aparece em "Minhas ofertas", vale só para o dono e não polui a lista de cupons do gestor.
      const client = await login(t.browser(), world.client.email);
      const [offer] = (await client.get('/api/me/offers')).body;
      expect(offer).toMatchObject({ establishmentId: world.estA.id, establishmentName: 'Bar A', campaignName: 'Niver', used: false });
      expect((await client.post('/api/coupons/validate').set(CSRF).send({ establishmentId: world.estA.id, code: offer.code, subtotalCents: 5000 })).body.discountCents).toBe(1000);
      const other = await login(t.browser(), orders.otherClient.email);
      expect((await other.post('/api/coupons/validate').set(CSRF).send({ establishmentId: world.estA.id, code: offer.code, subtotalCents: 5000 })).body.code).toBe('COUPON_INVALID');
      expect((await manager.get(`/api/establishments/${world.estA.id}/coupons`)).body).toHaveLength(0);
    });

    it('inativos e frequentes; taxa de uso por segmento', async () => {
      const now = new Date();
      await buy(orders.otherClient.id, new Date(now.getTime() - 45 * DAY)); // inativo há 45 dias
      for (const daysAgo of [1, 5, 9]) await buy(world.client.id, new Date(now.getTime() - daysAgo * DAY)); // 3 pedidos em 30 dias

      expect((await manager.post(`/api/establishments/${world.estA.id}/campaigns`).set(CSRF).send({ name: 'Volta', segment: 'inactive', discountType: 'fixed', discountValue: 1000, validDays: 10 })).body.code).toBe('INVALID_THRESHOLD');
      const inactive = (await manager.post(`/api/establishments/${world.estA.id}/campaigns`).set(CSRF).send({ name: 'Volta', segment: 'inactive', threshold: 30, discountType: 'fixed', discountValue: 1000, validDays: 10 })).body;
      const frequent = (await manager.post(`/api/establishments/${world.estA.id}/campaigns`).set(CSRF).send({ name: 'VIP', segment: 'frequent', threshold: 3, discountType: 'percent', discountValue: 10, validDays: 30 })).body;
      expect(inactive).toMatchObject({ sent: 1, eligibleNow: 1 });
      expect(frequent).toMatchObject({ sent: 1, eligibleNow: 1 });
      const vipGrant = await t.prisma.campaignGrant.findFirstOrThrow({ where: { campaignId: frequent.id }, include: { coupon: true } });
      expect(vipGrant).toMatchObject({ userId: world.client.id, coupon: { code: expect.stringMatching(/^VIP-/), restrictedToUserId: world.client.id, maxUses: 1 } });

      // O cliente usa o cupom VIP num pedido pago: a taxa de uso do segmento sobe para 100%.
      const order = await buy(world.client.id, now);
      await t.prisma.couponRedemption.create({ data: { couponId: vipGrant.couponId, userId: world.client.id, orderId: order.id } });
      const list = (await manager.get(`/api/establishments/${world.estA.id}/campaigns`)).body as { name: string; used: number; usageRate: number }[];
      expect(list.find(c => c.name === 'VIP')).toMatchObject({ used: 1, usageRate: 100 });
      expect(list.find(c => c.name === 'Volta')).toMatchObject({ used: 0, usageRate: 0 });
      const client = await login(t.browser(), world.client.email);
      expect((await client.get('/api/me/offers')).body[0]).toMatchObject({ campaignName: 'VIP', used: true });

      // Campanha que já enviou não é apagada; desativada para de enviar.
      expect((await manager.delete(`/api/establishments/${world.estA.id}/campaigns/${inactive.id}`).set(CSRF)).body.code).toBe('CAMPAIGN_IN_USE');
      await manager.patch(`/api/establishments/${world.estA.id}/campaigns/${inactive.id}`).set(CSRF).send({ active: false });
      const nextMonth = new Date(now.getTime() + 32 * DAY);
      await campaigns().dispatch(nextMonth);
      expect(await t.prisma.campaignGrant.count({ where: { campaignId: inactive.id } })).toBe(1);
    });

    it('cliente informa a data de nascimento no perfil; campanhas exigem plano com promoções', async () => {
      const client = await login(t.browser(), world.client.email);
      expect((await client.patch('/api/me').set(CSRF).send({ birthDate: '1990-05-20' })).body.user.birthDate).toBe('1990-05-20');
      expect((await client.patch('/api/me').set(CSRF).send({ birthDate: '2999-01-01' })).status).toBe(400);
      const managerStart = await login(t.browser(), world.managerStart.email);
      expect((await managerStart.get(`/api/establishments/${world.estStart.id}/campaigns`)).status).toBe(403);
    });
  });
});
