import { expect, test } from '@playwright/test';
import { Api, menuItems } from '../support/api';
import { ACCOUNTS, SEED } from '../support/env';
import { dbOne, dbQuery } from '../support/db';
import { clientApi, managerApi, releaseTable, tableMap, uniq } from '../support/domain';
import { recordMetric } from '../support/metrics';
import { newClientContext, newStaffContext, nav } from '../support/ui';

// Sprint 1 — navegação de restaurantes (11,12), cardápio (03), perfil (13), fila de espera (21), promoções (29), fichas técnicas (31), admin (34,36,37).

test('S1-11/12/03 · restaurantes por distância com status, página do restaurante e cardápio (≤ 2 s)', async ({ browser }) => {
  const api = await Api.create();
  const list = await api.get('restaurants', { lat: -22.9056, lng: -47.0608, sort: 'distance', radiusKm: 50 });
  expect(list.status).toBe(200);
  const d = list.body.items.map((r: any) => r.distanceM);
  expect(d.every((v: number | null) => v !== null)).toBe(true);
  expect([...d].sort((a: number, b: number) => a - b)).toEqual(d); // ordenado por distância
  expect(list.body.items.every((r: any) => ['open', 'busy', 'paused', 'closed'].includes(r.orderingStatus))).toBe(true);
  const names = list.body.items.map((r: any) => r.name);
  expect(names).not.toContain('Bar do Mestre Express'); // inativo
  expect(names).not.toContain('Restaurante São Paulo'); // suspenso
  expect((await api.get('restaurants', { openNow: true })).body.items.every((r: any) => r.isOpenNow)).toBe(true);

  const ctx = await newClientContext(browser);
  const page = await ctx.newPage();
  await page.goto('/');
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Explorar restaurantes' }).click();
  await page.getByRole('button', { name: 'Restaurantes' }).click();
  await expect(page.getByText(/estabelecimentos? encontrados?/)).toBeVisible({ timeout: 10_000 });
  recordMetric('ficha 11 (1ª abertura, frio: inclui carregar o chunk da tela): abrir busca → lista', Date.now() - t0);
  // Medição para a meta de 2 s: segunda abertura, com bundle em cache e a API consultada de novo.
  await page.getByRole('button', { name: 'Início' }).dispatchEvent('click');
  await expect(page.getByRole('button', { name: 'Restaurantes' })).toBeVisible();
  const tWarm = Date.now();
  await page.getByRole('button', { name: 'Restaurantes' }).dispatchEvent('click');
  await expect(page.getByText(/estabelecimentos? encontrados?/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Bar do Mestre', { exact: true }).first()).toBeVisible();
  const warm11 = Date.now() - tWarm;
  recordMetric('ficha 11: abrir busca → lista de restaurantes (aquecido)', warm11, 2000);
  expect(warm11, 'ficha 11: busca em até 2 s').toBeLessThanOrEqual(2000);
  await expect(page.getByText('Bar do Mestre', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Aceitando pedidos|Aberto|Pedidos pausados|Alta demanda/).first()).toBeVisible(); // status visível
  await expect(page.getByText('Restaurante São Paulo')).toHaveCount(0);

  // mapa (ficha 11) e filtro "Aberto agora" (servidor)
  const listed = Number(/(\d+) estabelecimento/.exec(await page.getByText(/estabelecimentos? encontrados?/).innerText())![1]);
  await page.getByRole('button', { name: 'Mapa', exact: true }).click();
  // cada pino tem o nome COMPLETO como nome acessível (antes: "Bar do" para 4 casas diferentes)
  const pins = page.locator('button.absolute.transition-transform');
  await expect(pins).toHaveCount(listed);
  const pinNames = (await pins.evaluateAll(els => els.map(el => el.getAttribute('aria-label') ?? ''))).sort();
  const apiNames = (await api.get('restaurants', { lat: -22.9056, lng: -47.0608, sort: 'distance', radiusKm: 50 })).body.items.map((r: any) => r.name as string);
  expect(new Set(pinNames).size, `nomes dos pinos distintos: ${pinNames.join(', ')}`).toBe(listed);
  for (const name of pinNames) expect(apiNames, `pino "${name}" é um restaurante da API`).toContain(name);
  for (const name of ['Bar do Mestre', 'Bar do Mestre 2', 'Bar do Zé']) expect(pinNames).toContain(name);
  await page.getByRole('button', { name: 'Bar do Mestre', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ver restaurante' })).toBeVisible();
  await expect(page.locator('p.font-display.font-semibold').last()).toHaveText('Bar do Mestre');
  await page.getByRole('button', { name: 'Lista', exact: true }).click();
  const openNow = (await api.get('restaurants', { openNow: true })).body.items.length;
  await page.getByRole('button', { name: /^Aberto agora$/ }).click();
  await expect(page.getByText(new RegExp(`^${openNow} estabelecimentos? encontrados?`))).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: /^Todos$/ }).click();

  // página do restaurante (ficha 12): nota, endereço, "Como chegar", horário do dia, botões
  await page.getByText('Bar do Mestre', { exact: true }).first().click();
  const detail = (await api.get(`restaurants/${SEED.mestre}`)).body;
  await expect(page.getByText('4.7').first()).toBeVisible();
  await expect(page.locator(`img[src="${detail.images[0]}"]`).first()).toBeVisible(); // galeria: primeira foto cadastrada pelo gestor
  await expect(page.getByText(detail.address)).toBeVisible();
  await expect(page.getByText('Como chegar')).toBeVisible();
  await expect(page.getByText(detail.hoursLabel)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver cardápio' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Reservar mesa/ })).toBeVisible(); // botão "reservar" (fluxo completo: S1-12 em gaps.spec.ts)

  // cardápio (ficha 03): foto, nome, descrição, preço; categorias; busca; ≤ 2 s
  const t1 = Date.now();
  await page.getByRole('button', { name: 'Ver cardápio' }).click();
  await page.getByRole('button', { name: 'Cervejas', exact: true }).click();
  const item = page.getByRole('button', { name: /Cerveja IPA 600ml/ });
  await expect(item).toBeVisible({ timeout: 5000 });
  recordMetric('ficha 03 (1ª abertura, frio): abrir cardápio → itens', Date.now() - t1);
  // Medição para a meta de 2 s: voltar e abrir o cardápio de novo (chunk em cache).
  await page.getByRole('button', { name: 'Voltar' }).first().click();
  const tWarm3 = Date.now();
  await page.getByRole('button', { name: 'Ver cardápio' }).click();
  await page.getByRole('button', { name: 'Cervejas', exact: true }).click();
  await expect(item).toBeVisible({ timeout: 5000 });
  const warm03 = Date.now() - tWarm3;
  recordMetric('ficha 03: abrir cardápio → itens com foto/nome/descrição/preço (aquecido)', warm03, 2000);
  expect(warm03, 'ficha 03: cardápio em até 2 s').toBeLessThanOrEqual(2000);
  await expect(item.locator('img')).toHaveAttribute('src', /https?:|\/api\//);
  await expect(item).toContainText('Artesanal com notas cítricas');
  await expect(item).toContainText(/R\$\s*\d+,\d{2}/);
  await expect(page.getByRole('button', { name: /X-Bacon/ })).toHaveCount(0); // esgotado não aparece
  await expect(page.getByText('Somente consulta.')).toBeVisible(); // sem QR da mesa não pede
  await page.getByLabel('Buscar no cardápio').fill('burger');
  await expect(page.getByRole('button', { name: /^X-Burger/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Cerveja IPA/ })).toHaveCount(0);
  await ctx.close();
});

test('S1-13 · perfil: editar dados salvos na conta e usados depois; endereços (criar, padrão, remover)', async ({ browser }) => {
  const acc = await Api.as(ACCOUNTS.client2.email);
  const before = (await acc.get('me')).body.user;
  for (const a of (await acc.get('me/addresses')).body as any[]) if (/E2E/.test(a.label)) await acc.del(`me/addresses/${a.id}`); // restos de execuções anteriores
  const ctx = await newClientContext(browser, { email: ACCOUNTS.client2.email });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Início' })).toBeVisible({ timeout: 15_000 });
  await nav(page, 'Perfil');
  await page.getByRole('button', { name: 'Editar' }).click();
  const newName = `Marina E2E ${uniq().slice(0, 4)}`;
  const [first, ...rest] = newName.split(' ');
  await page.getByLabel('Nome', { exact: true }).fill(first);
  await page.getByLabel('Sobrenome').fill(rest.join(' '));
  await page.getByRole('button', { name: /Salvar alterações/ }).click(); // clique real (S1-13b)
  await expect(page.getByText(/Dados salvos/)).toBeVisible({ timeout: 8000 });
  expect((await acc.get('me')).body.user.name).toBe(newName);
  expect((await dbOne<any>('select name from users where id=$1', [before.id]))!.name).toBe(newName);
  // validação do servidor: e-mail duplicado
  const dup = await acc.patch('me', { email: ACCOUNTS.client.email });
  expect(dup.status).toBe(409);
  expect(dup.body.code).toBe('EMAIL_IN_USE');
  // restaura
  await acc.patch('me', { name: before.name });

  // endereços (já existe um padrão criado pela API, então o novo entra como não-padrão)
  const base = await acc.post('me/addresses', { label: 'Base E2E', street: 'Rua Base, 1', city: 'Campinas, SP', isDefault: true });
  expect(base.status).toBe(201);
  await nav(page, 'Perfil');
  await page.getByRole('button', { name: 'Meus endereços' }).click();
  await page.getByRole('button', { name: /Novo endereço|Adicionar endereço/ }).first().click();
  await page.getByLabel('Nome do endereço').fill('Casa E2E');
  await page.getByLabel('Rua e número').fill('Rua dos Testes, 42');
  await page.getByLabel('Cidade / UF').fill('Campinas, SP');
  await page.getByRole('button', { name: /^Salvar/ }).click();
  await expect(page.getByText('Casa E2E')).toBeVisible({ timeout: 8000 });
  const addr = await dbOne<any>("select id, is_default from user_addresses where user_id=$1 and label='Casa E2E'", [before.id]);
  expect(addr).toBeTruthy();
  await page.getByRole('button', { name: 'Definir como padrão' }).first().click();
  await expect.poll(async () => (await dbOne<any>("select is_default from user_addresses where user_id=$1 and label='Casa E2E'", [before.id]))!.is_default).toBe(true);
  expect((await dbQuery<any>('select count(*)::int c from user_addresses where user_id=$1 and is_default', [before.id]))[0].c).toBe(1); // um padrão por conta
  expect((await dbOne<any>("select is_default from user_addresses where user_id=$1 and label='Base E2E'", [before.id]))!.is_default).toBe(false);
  await page.getByLabel('Remover endereço Casa E2E').click();
  await expect.poll(async () => (await dbQuery('select 1 from user_addresses where user_id=$1 and label=$2', [before.id, 'Casa E2E'])).length).toBe(0);
  await acc.del(`me/addresses/${base.body.id}`);
  await ctx.close();
});

test('S1-13b · DEFEITO: botão "Salvar alterações" do Editar perfil precisa estar clicável (não coberto pela barra inferior)', async ({ browser }) => {
  const ctx = await newClientContext(browser, { email: ACCOUNTS.client2.email });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Início' })).toBeVisible({ timeout: 15_000 });
  await nav(page, 'Perfil');
  await page.getByRole('button', { name: 'Editar' }).click();
  const save = page.getByRole('button', { name: /Salvar alterações/ });
  await expect(save).toBeVisible();
  const box = (await save.boundingBox())!;
  const covered = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest('nav') ? 'nav' : el?.closest('button')?.textContent ?? el?.tagName;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.screenshot({ path: 'e2e/.results/defect-edit-profile-save-covered.png' });
  expect(covered, 'o ponto central do botão Salvar deveria pertencer ao próprio botão').not.toBe('nav');
  await ctx.close();
});

test('S1-21 · fila de espera: adicionar, reordenar, avisar ao liberar mesa, sentar e remover (posição única)', async ({ browser }) => {
  const E = SEED.mestre;
  const mgr = await managerApi();
  const stamp = uniq().slice(0, 5);
  const ctx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const page = await ctx.newPage();
  await page.goto('/gestor');
  await page.getByRole('button', { name: 'Fila de espera' }).click();
  await expect(page.getByText('Total na fila')).toBeVisible({ timeout: 15_000 });
  const before = (await mgr.get(`establishments/${E}/waitlist`)).body.entries.length;
  await page.getByRole('button', { name: /Adicionar à fila|Adicionar/ }).first().click();
  await page.getByLabel('Nome', { exact: true }).fill(`Grupo ${stamp}`);
  await page.getByLabel('Celular').fill('(19) 98888-7777');
  await page.getByLabel('Tamanho do grupo').fill('3');
  await page.getByRole('button', { name: /^Adicionar|Salvar/ }).last().click();
  await expect(page.locator('p').filter({ hasText: new RegExp(`^Grupo ${stamp}$`) })).toBeVisible({ timeout: 8000 }); // linha da fila (o toast tem texto maior)
  const wl = (await mgr.get(`establishments/${E}/waitlist`)).body;
  expect(wl.entries).toHaveLength(before + 1);
  const mine = wl.entries.find((e: any) => e.name === `Grupo ${stamp}`);
  expect(mine.position).toBe(before + 1);
  expect(new Set(wl.entries.map((e: any) => e.position)).size).toBe(wl.entries.length); // posições únicas
  // validações
  expect((await mgr.post(`establishments/${E}/waitlist`, { name: 'X', phone: '123', partySize: 2 })).status).toBe(400);
  expect((await mgr.post(`establishments/${E}/waitlist`, { name: 'Grupo Grande', phone: '(19) 98888-7777', partySize: 0 })).status).toBe(400);
  // subir uma posição pela UI
  await page.getByLabel(`Subir Grupo ${stamp}`).click();
  await expect.poll(async () => (await mgr.get(`establishments/${E}/waitlist`)).body.entries.find((e: any) => e.name === `Grupo ${stamp}`).position).toBe(before);
  // concorrência: duas inclusões simultâneas não repetem posição
  const [c1, c2] = await Promise.all([1, 2].map(i => mgr.post(`establishments/${E}/waitlist`, { name: `Conc ${stamp}${i}`, phone: '(19) 97777-6666', partySize: 2 })));
  expect([c1.status, c2.status]).toEqual([201, 201]);
  const after = (await mgr.get(`establishments/${E}/waitlist`)).body.entries;
  expect(new Set(after.map((e: any) => e.position)).size).toBe(after.length);
  // liberar mesa → próximo da fila é avisado automaticamente
  const t = (await tableMap(mgr, E)).tables.find((x: any) => x.label === 'Mesa 3'); // ocupada (seed)
  const rel = await mgr.post(`establishments/${E}/tables/${t.id}/release`);
  expect(rel.status).toBeLessThan(300);
  await expect.poll(async () => (await mgr.get(`establishments/${E}/waitlist`)).body.entries.some((e: any) => e.status === 'notified'), { timeout: 8000 }).toBe(true);
  const notified = (await mgr.get(`establishments/${E}/waitlist`)).body.entries.find((e: any) => e.status === 'notified');
  expect(notified.notifiedTableLabel).toBeTruthy();
  expect((await dbQuery('select status from waitlist_notifications order by created_at desc limit 1'))[0]).toBeTruthy();
  // sentar e remover (limpeza)
  for (const e of (await mgr.get(`establishments/${E}/waitlist`)).body.entries) if (e.name.includes(stamp)) await mgr.del(`establishments/${E}/waitlist/${e.id}`);
  expect((await mgr.get(`establishments/${E}/waitlist`)).body.entries.some((e: any) => e.name.includes(stamp))).toBe(false);
  await releaseTable(mgr, E, t.id);
  // permissão: cliente não acessa a fila
  expect([401, 403, 404]).toContain((await (await clientApi()).get(`establishments/${E}/waitlist`)).status);
  await ctx.close();
});

test('S1-29/31 · promoções (vigente/futura/expirada, plano) e fichas técnicas (custo calculado pelo servidor)', async () => {
  const E = SEED.mestre;
  const mgr = await managerApi();
  const items = await menuItems(await Api.create(), E);
  const cerveja = items.find(i => i.name === 'Cerveja IPA 600ml');
  const day = 86_400_000;
  const mk = (name: string, start: number, end: number) => mgr.post(`establishments/${E}/promotions`, { name, discountPercent: 50, startsAt: new Date(Date.now() + start).toISOString(), endsAt: new Date(Date.now() + end).toISOString(), itemIds: [items.find(i => i.name === 'Batata Frita').id] });
  const created: string[] = [];
  try {
    // seed já tem promoção expirada p/ cerveja IPA (Quarta universitária): preço cheio; Batata tem promo futura (25%) → cheia hoje
    const batata = items.find(i => i.name === 'Batata Frita');
    expect(batata.finalPriceCents).toBe(batata.priceCents);
    expect(cerveja.finalPriceCents).toBe(cerveja.priceCents);
    const active = await mk(`Promo E2E ${uniq().slice(0, 4)}`, -day, day);
    expect(active.status, JSON.stringify(active.body)).toBe(201);
    created.push(active.body.id);
    const after = (await menuItems(await Api.create(), E)).find(i => i.name === 'Batata Frita');
    expect(after.finalPriceCents).toBe(Math.round(batata.priceCents * (1 - 0.5))); // 50% aplicado pelo servidor
    expect(after.priceCents).toBe(batata.priceCents); // preço original nunca muda
    expect(after.promotion?.discountPercent).toBe(50);
    expect(active.body.state).toBe('active');
    const future = await mk('Futura E2E', day, 2 * day);
    const expired = await mk('Expirada E2E', -3 * day, -day);
    created.push(future.body.id, expired.body.id);
    expect([future.body.state, expired.body.state]).toEqual(['scheduled', 'expired']);
    // validações
    expect((await mgr.post(`establishments/${E}/promotions`, { name: 'x', discountPercent: 101, startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + day).toISOString(), itemIds: [batata.id] })).status).toBe(400);
    expect((await mgr.post(`establishments/${E}/promotions`, { name: 'x', discountPercent: 10, startsAt: new Date(Date.now() + day).toISOString(), endsAt: new Date().toISOString(), itemIds: [batata.id] })).status).toBeClientError();
    // plano Start (Cantina) não tem promoções
    const paula = await Api.as(ACCOUNTS.managerStart.email);
    expect((await paula.get(`establishments/${SEED.cantina}/promotions`)).status).toBe(403);
    // encerra pelo próprio período, sem job: apaga a vigente e o preço volta
    expect((await mgr.del(`establishments/${E}/promotions/${active.body.id}`)).status).toBeLessThan(300);
    expect((await menuItems(await Api.create(), E)).find(i => i.name === 'Batata Frita').finalPriceCents).toBe(batata.priceCents);
  } finally {
    for (const id of created) await mgr.del(`establishments/${E}/promotions/${id}`);
  }

  // fichas técnicas: custo calculado pelo servidor (X-Burger: 1×1,20 + 1×7,20 + 2×0,90 + 20×0,06 = 11,40; preço 28,90)
  const sheets = (await mgr.get(`establishments/${E}/technical-sheets`)).body;
  const burger = sheets.items?.find?.((s: any) => s.menuItemName === 'X-Burger') ?? sheets.find?.((s: any) => s.menuItemName === 'X-Burger');
  expect(burger).toBeTruthy();
  expect(Number(burger.totalCost)).toBeCloseTo(11.4, 2);
  expect(burger.costPercent).toBeCloseTo((11.4 / 28.9) * 100, 0);
  expect(burger.overLimit).toBe(true); // limite 35%
  // custo de insumo muda → recalculado a cada leitura
  const ing = (await mgr.get(`establishments/${E}/ingredients`)).body;
  const list = ing.items ?? ing;
  const hamb = list.find((i: any) => i.name === 'Hambúrguer 180g');
  const old = hamb.unitCost;
  try {
    expect((await mgr.patch(`establishments/${E}/ingredients/${hamb.id}`, { unitCost: 1 })).status).toBeLessThan(300);
    const s2 = (await mgr.get(`establishments/${E}/technical-sheets`)).body;
    const b2 = (s2.items ?? s2).find((s: any) => s.menuItemName === 'X-Burger');
    expect(Number(b2.totalCost)).toBeCloseTo(5.2, 2);
    expect(b2.overLimit).toBe(false);
  } finally {
    await mgr.patch(`establishments/${E}/ingredients/${hamb.id}`, { unitCost: Number(old) });
  }
  expect([401, 403, 404]).toContain((await (await Api.as(ACCOUNTS.attendant.email)).get(`establishments/${E}/technical-sheets`)).status);
});

test('S1-34/36/37 · admin: estabelecimentos, usuários (papel/permissões/suspensão/histórico) e planos (efeito imediato)', async ({ browser }) => {
  const admin = await Api.as(ACCOUNTS.admin.email);
  const ctx = await newStaffContext(browser, ACCOUNTS.admin.email);
  const page = await ctx.newPage();
  await page.goto('/admin');
  await expect(page.getByText('Admin FilaZero').first()).toBeVisible({ timeout: 15_000 });
  for (const label of ['Estabelecimentos', 'Usuários', 'Planos']) await expect(page.getByRole('button', { name: new RegExp(label) }).first()).toBeVisible();
  await page.getByRole('button', { name: /Estabelecimentos/ }).first().click();
  await expect(page.getByText('Bar do Mestre', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Restaurante São Paulo').first()).toBeVisible();

  // estabelecimento: criar, editar, suspender (some do público e bloqueia a equipe) e reativar
  const list = await admin.get('admin/establishments', { pageSize: 50 });
  expect(list.body.counts.all).toBeGreaterThanOrEqual(10);
  const org = (await admin.get('admin/organizations')).body;
  const plan = (await admin.get('admin/plans')).body;
  const planStart = (plan.items ?? plan).find((p: any) => p.name === 'Start');
  const orgId = (org.items ?? org)[0].id;
  const name = `Casa E2E ${uniq().slice(0, 5)}`;
  const create = await admin.post('admin/establishments', { name, type: 'bar', city: 'Campinas', address: 'Rua E2E, 1', latitude: -22.9, longitude: -47.06, organizationId: orgId, planId: planStart.id, foodCategories: ['Bar'], openingHours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, opensAt: '00:00', closesAt: '23:59' })) });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  const eid = create.body.id;
  expect((await (await Api.create()).get('restaurants')).body.items.map((r: any) => r.name)).toContain(name);
  expect((await admin.patch(`admin/establishments/${eid}`, { name: `${name} editada` })).status).toBe(200);
  expect((await admin.patch(`admin/establishments/${eid}/status`, { status: 'suspended' })).status).toBeLessThan(300);
  expect((await (await Api.create()).get('restaurants')).body.items.map((r: any) => r.name)).not.toContain(`${name} editada`);
  expect((await (await Api.create()).get(`restaurants/${eid}`)).status).toBeClientError();
  expect((await admin.patch(`admin/establishments/${eid}/status`, { status: 'inactive' })).status).toBeLessThan(300);
  expect((await admin.post('admin/establishments', { name: 'x' })).status).toBe(400);

  // plano: trocar plano libera/bloqueia recurso na hora (Cantina Start → Pro dá promoções)
  const paula = await Api.as(ACCOUNTS.managerStart.email);
  const planPro = (plan.items ?? plan).find((p: any) => p.name === 'Pro');
  expect((await paula.get(`establishments/${SEED.cantina}/promotions`)).status).toBe(403);
  try {
    expect((await admin.put(`admin/establishments/${SEED.cantina}/plan`, { planId: planPro.id })).status).toBeLessThan(300);
    expect((await paula.get(`establishments/${SEED.cantina}/promotions`)).status).toBe(200);
  } finally {
    await admin.put(`admin/establishments/${SEED.cantina}/plan`, { planId: planStart.id });
  }
  expect((await paula.get(`establishments/${SEED.cantina}/promotions`)).status).toBe(403);
  // CRUD de plano
  const pn = `Plano E2E ${uniq().slice(0, 4)}`;
  const np = await admin.post('admin/plans', { name: pn, monthlyPriceCents: 1234, limits: { units: 1, tables: 5, staff: 2 }, features: ['floor_plan'] });
  expect(np.status, JSON.stringify(np.body)).toBe(201);
  expect((await admin.patch(`admin/plans/${np.body.id}`, { monthlyPriceCents: 4321 })).status).toBe(200);
  expect((await admin.del(`admin/plans/${np.body.id}`)).status).toBeLessThan(300);
  // plano em uso não pode ser removido
  expect((await admin.del(`admin/plans/${planStart.id}`)).status).toBeClientError();

  // usuários: filtro, papel/permissões com histórico (antes/depois), suspensão com perda imediata de acesso
  const users = await admin.get('admin/users', { role: 'attendant' });
  expect(users.body.items.every((u: any) => u.role === 'attendant')).toBe(true);
  const ana = users.body.items.find((u: any) => u.email === 'ana@bardomestre.com.br');
  const anaApi = await Api.as('ana@bardomestre.com.br');
  expect((await anaApi.get(`establishments/${SEED.mestre}/table-map`)).status).toBe(200);
  const susp = await admin.patch(`admin/users/${ana.id}/status`, { status: 'suspended' });
  expect(susp.status).toBeLessThan(300);
  expect((await anaApi.get(`establishments/${SEED.mestre}/table-map`)).status).toBeGreaterThanOrEqual(401); // sessão cai na hora
  const reactivate = await admin.patch(`admin/users/${ana.id}/status`, { status: 'active' });
  expect(reactivate.status).toBeLessThan(300);
  const audit = (await admin.get('admin/permission-audit', { userId: ana.id })).body;
  const actions = (audit.items ?? audit).map((a: any) => a.action);
  expect(actions).toEqual(expect.arrayContaining(['suspended', 'reactivated']));
  // admin não suspende a si mesmo e a plataforma não fica sem admin
  const me = (await admin.get('me')).body.user;
  expect((await admin.patch(`admin/users/${me.id}/status`, { status: 'suspended' })).status).toBeClientError();
  expect([401, 403]).toContain((await (await Api.as(ACCOUNTS.manager.email)).get('admin/plans')).status);
  await ctx.close();
});
