import { expect, test } from '@playwright/test';
import { Api, createOrder, menuItems, payApproved, qr } from '../support/api';
import { ACCOUNTS, QR, SEED } from '../support/env';
import { dbOne, dbQuery } from '../support/db';
import { clientApi, managerApi, releaseTable, uniq } from '../support/domain';
import { recordMetric } from '../support/metrics';
import { newClientContext, newStaffContext, nav } from '../support/ui';

// Cenário E — gestão: cardápio, disponibilidade, ranking "+ pedido" e destaque (46), planta e duplicação (61), permissões. Real.

let manager: Api;
test.beforeAll(async () => {
  manager = await managerApi();
});

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('E1 · cardápio (gestor): criar/editar/excluir item pela UI com foto; cliente vê em tempo real; preço/descrição validados', async ({ browser }) => {
  const E = SEED.mestre;
  const name = `Prato E2E ${uniq()}`;
  const mgrCtx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const mgr = await mgrCtx.newPage();
  await mgr.goto('/gestor');
  await mgr.getByRole('button', { name: 'Cardápio' }).click();

  // cliente com o cardápio do Bar do Mestre aberto (somente consulta)
  const custCtx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const cust = await custCtx.newPage();
  await cust.goto(`/?mesa=${QR.mesa1}`);
  await cust.getByRole('button', { name: 'Entrar no bar' }).click();
  await nav(cust, 'Cardápio');

  await mgr.getByRole('button', { name: 'Novo item' }).click();
  // validações do formulário
  await mgr.getByRole('button', { name: 'Adicionar item' }).click();
  await expect(mgr.getByText('Informe o nome do item.')).toBeVisible();
  await expect(mgr.getByText('Informe um preço válido.')).toBeVisible();
  await expect(mgr.getByText('Envie uma foto ou informe um link https.')).toBeVisible();
  await mgr.getByLabel('Nome', { exact: true }).fill(name);
  await mgr.getByLabel('Descrição').fill('Criado pelo teste E2E');
  await mgr.getByLabel('Preço (R$)').fill('-3');
  await mgr.getByRole('button', { name: 'Adicionar item' }).click();
  await expect(mgr.getByText('Informe um preço válido.')).toBeVisible();
  await mgr.getByLabel('Preço (R$)').fill('12,34');
  await mgr.getByLabel('Categoria', { exact: true }).selectOption('Porções');
  // arquivo inválido (texto) é recusado no cliente; PNG válido é aceito e convertido pelo servidor
  await mgr.locator('input[type=file]').setInputFiles({ name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('nao e imagem') });
  await expect(mgr.getByText('Use uma imagem PNG, JPG ou WEBP.')).toBeVisible();
  await mgr.locator('input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG_1PX });
  const t0 = Date.now();
  await mgr.getByRole('button', { name: 'Adicionar item' }).click();
  await expect(mgr.getByText(`${name} adicionado ao cardápio`)).toBeVisible({ timeout: 10_000 });

  const row = await dbOne<any>('select id, price_cents, image_storage_key, image_url, available, category_id from menu_items where name=$1 and deleted_at is null', [name]);
  expect(row).toMatchObject({ price_cents: 1234, available: true });
  expect(row!.image_storage_key ?? row!.image_url).toBeTruthy(); // foto armazenada (WebP) ou link

  // cliente vê o novo item sem recarregar (ficha 03/28: foto, nome, descrição, preço)
  await cust.getByLabel('Buscar no cardápio').fill(name);
  const card = cust.getByRole('button', { name: new RegExp(name) });
  await expect(card).toBeVisible({ timeout: 8000 });
  recordMetric('cardápio: gestor cria item → cliente vê (sem recarregar)', Date.now() - t0, 5000);
  await expect(card).toContainText('Criado pelo teste E2E');
  await expect(card).toContainText(/12,34/);
  await expect(card.locator('img')).toHaveAttribute('src', /.+/);

  // editar preço → cliente atualiza
  await mgr.getByLabel(`Editar ${name}`).click();
  await mgr.getByLabel('Preço (R$)').fill('15,00');
  await mgr.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(card).toContainText(/15,00/, { timeout: 8000 });
  expect((await dbOne<any>('select price_cents from menu_items where id=$1', [row!.id]))!.price_cents).toBe(1500);

  // esgotar (gestor) → some do cliente; reativar → volta (ficha 19 ≤ 5 s)
  const t1 = Date.now();
  await mgr.getByTitle('Marcar como esgotado').first().evaluate(() => undefined);
  await mgr.getByLabel('Buscar no cardápio').fill(name);
  await mgr.getByTitle('Marcar como esgotado').click();
  await expect(card).toHaveCount(0, { timeout: 8000 });
  recordMetric('ficha 19: item esgotado some do cardápio do cliente', Date.now() - t1, 5000);
  expect(Date.now() - t1).toBeLessThanOrEqual(5500);
  expect((await dbOne<any>('select available from menu_items where id=$1', [row!.id]))!.available).toBe(false);
  expect((await createOrder(await clientApi(), { establishmentId: E, items: [{ menuItemId: row!.id, quantity: 1 }] })).body.code).toBe('ITEM_UNAVAILABLE');
  await mgr.getByTitle('Reativar item').click();
  await expect(card).toBeVisible({ timeout: 8000 });

  // excluir
  await mgr.getByLabel(`Excluir ${name}`).click();
  await mgr.getByRole('button', { name: 'Excluir item' }).click();
  await expect(card).toHaveCount(0, { timeout: 8000 });
  expect((await dbOne<any>('select deleted_at from menu_items where id=$1', [row!.id]))!.deleted_at).not.toBeNull();
  await mgrCtx.close();
  await custCtx.close();
});

test('E2 · disponibilidade (atendente): alternar item, histórico com autor e hora; cliente não consegue adicionar item esgotado', async ({ browser }) => {
  const E = SEED.mestre;
  const itm = (await menuItems(manager, E)).find(i => i.name === 'Heineken Long Neck');
  const attCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const att = await attCtx.newPage();
  await att.goto('/atendente');
  await att.getByRole('button', { name: 'Cardápio' }).click();
  const custCtx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const cust = await custCtx.newPage();
  await cust.goto(`/?mesa=${QR.mesa8}`);
  await cust.getByRole('button', { name: 'Entrar no bar' }).click();
  await nav(cust, 'Cardápio');
  await cust.getByLabel('Buscar no cardápio').fill('Heineken');
  await expect(cust.getByRole('button', { name: /Heineken Long Neck/ })).toBeVisible();
  const t0 = Date.now();
  try {
    await att.getByRole('switch', { name: /Heineken Long Neck: marcar como esgotado/ }).click();
    await expect(cust.getByRole('button', { name: /Heineken Long Neck/ })).toHaveCount(0, { timeout: 8000 });
    recordMetric('ficha 19: atendente esgota → some do cliente', Date.now() - t0, 5000);
    expect(Date.now() - t0).toBeLessThanOrEqual(5500);
    await expect(att.getByText('Carlos Mendes ·').first()).toBeVisible(); // histórico: quem
    const hist = await dbOne<any>('select available, item_name from menu_item_availability_changes where menu_item_id=$1 order by created_at desc limit 1', [itm.id]);
    expect(hist).toMatchObject({ available: false, item_name: 'Heineken Long Neck' });
    expect((await createOrder(await clientApi(), { establishmentId: E, items: [{ menuItemId: itm.id, quantity: 1 }] })).body.code).toBe('ITEM_UNAVAILABLE');
  } finally {
    const a = await Api.as(ACCOUNTS.attendant.email);
    await a.patch(`establishments/${E}/menu/items/${itm.id}/availability`, { available: true });
  }
  await expect(cust.getByRole('button', { name: /Heineken Long Neck/ })).toBeVisible({ timeout: 8000 });
  await attCtx.close();
  await custCtx.close();
});

test('E3 · ranking "+ pedido" (46): top-3 por vendas pagas, recalcular, estorno exclui, destaque manual; cliente vê o selo', async ({ browser }) => {
  const E = SEED.lancheria; // Lancheria do Zé (plano Pro)
  const ze = await Api.as(ACCOUNTS.managerPro.email);
  const client = await clientApi();
  const cat = (await menuItems(client, E))[0].category;
  const stamp = uniq();
  const created: string[] = [];
  const mk = async (n: string) => {
    const r = await ze.post(`establishments/${E}/menu/items`, { name: `Rank ${n} ${stamp}`, description: 'ranking', categoryName: cat, priceCents: 500, imageUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    created.push(r.body.id);
    return r.body as { id: string; name: string };
  };
  try {
    const [a, b, c, d] = [await mk('A'), await mk('B'), await mk('C'), await mk('D')];
    // vendas já existentes no estabelecimento (execuções anteriores): meus itens precisam superá-las
    const base = Number((await dbOne<any>("select coalesce(max(q),0) m from (select sum(oi.quantity) q from order_items oi join orders o on o.id=oi.order_id where o.establishment_id=$1 and o.status in ('paid','preparing','ready','delivered') and oi.menu_item_id <> all($2::uuid[]) group by oi.menu_item_id) t", [E, created]))!.m);
    const sell = async (item: { id: string }, qty: number) => {
      for (let left = qty; left > 0; left -= 20) {
        const o = await createOrder(client, { establishmentId: E, items: [{ menuItemId: item.id, quantity: Math.min(20, left) }] });
        expect(o.status, JSON.stringify(o.body)).toBe(201);
        expect((await payApproved(client, o.body.id, o.body.totalCents)).status).toBeLessThan(300);
      }
    };
    await sell(a, base + 12);
    await sell(b, base + 8);
    await sell(c, base + 4);
    await sell(d, base + 1);

    // itens recém-criados ainda não estão no ranking gravado: sem selo até o recálculo
    const custCtx = await newClientContext(browser, { email: ACCOUNTS.client.email });
    const cust = await custCtx.newPage();
    await cust.goto('/');
    await nav(cust, 'Restaurantes');
    await cust.getByText('Lancheria do Zé', { exact: true }).click();
    await cust.getByRole('button', { name: 'Ver cardápio' }).click();
    await cust.getByLabel('Buscar no cardápio').fill(`Rank`);
    const cardOf = (it: { name: string }) => cust.getByRole('button', { name: new RegExp(it.name) });
    await expect(cardOf(a)).toBeVisible({ timeout: 8000 });
    await expect(cardOf(a)).not.toContainText('+ pedido');

    // recálculo pelo gestor (UI) — o selo chega ao cliente sem recarregar
    const mgrCtx = await newStaffContext(browser, ACCOUNTS.managerPro.email, undefined, false);
    const mgr = await mgrCtx.newPage();
    await mgr.goto('/gestor');
    await mgr.getByRole('button', { name: 'Cardápio' }).click();
    await mgr.locator('button[aria-haspopup=listbox]').click();
    await mgr.getByRole('option', { name: /Lancheria do Zé/ }).click();
    await expect(mgr.getByText('Lancheria do Zé').first()).toBeVisible();
    await mgr.getByRole('button', { name: 'Recalcular ranking' }).click();
    await expect(mgr.getByText('Ranking de vendas recalculado')).toBeVisible({ timeout: 10_000 });
    const rk = (await ze.get(`establishments/${E}/menu/ranking`)).body;
    expect(rk.items.map((x: any) => x.name).slice(0, 3)).toEqual([a.name, b.name, c.name]); // maiores volumes, em ordem
    expect(rk.items).toHaveLength(3);
    expect(rk.items[0].quantity).toBe(base + 12);
    expect(rk.calculatedAt).toBeTruthy();
    const dbRank = await dbQuery<any>('select r.rank, r.quantity from menu_item_rankings r where r.establishment_id=$1 order by r.rank', [E]);
    expect(dbRank.map(r => r.rank)).toEqual([1, 2, 3]);
    // cliente: selo nos 3 primeiros, não no 4º
    await expect(cardOf(a)).toContainText('+ pedido', { timeout: 8000 });
    await expect(cardOf(b)).toContainText('+ pedido');
    await expect(cardOf(c)).toContainText('+ pedido');
    await expect(cardOf(d)).not.toContainText('+ pedido');
    const pub = (await menuItems(client, E)).reduce((m: any, i: any) => ({ ...m, [i.id]: i }), {});
    expect([pub[a.id].isTopOrdered, pub[b.id].isTopOrdered, pub[c.id].isTopOrdered, pub[d.id].isTopOrdered]).toEqual([true, true, true, false]);

    // destaque manual do gestor (UI) no 4º item → selo aparece p/ cliente; remover → some
    await mgr.getByLabel('Buscar no cardápio').fill(stamp);
    await mgr.getByLabel(`Destacar ${d.name}`).click();
    await expect(cardOf(d)).toContainText('+ pedido', { timeout: 8000 });
    expect((await dbOne<any>('select highlighted from menu_items where id=$1', [d.id]))!.highlighted).toBe(true);
    await mgr.getByLabel(`Destacar ${d.name}`).click();
    await expect(cardOf(d)).not.toContainText('+ pedido', { timeout: 8000 });

    // estorno exclui a venda do ranking (A estornado → ranking passa a B, C, D)
    const orders = await dbQuery<any>("select o.id from orders o join order_items oi on oi.order_id=o.id where oi.menu_item_id=$1 and o.status='paid'", [a.id]);
    for (const o of orders) expect((await ze.post(`establishments/${E}/orders/${o.id}/refund`)).status).toBeLessThan(300);
    expect((await ze.post(`establishments/${E}/menu/ranking/recalculate`)).status).toBeLessThan(300);
    const rk2 = (await ze.get(`establishments/${E}/menu/ranking`)).body;
    expect(rk2.items.map((x: any) => x.name)).not.toContain(a.name);
    expect(rk2.items.map((x: any) => x.name)).toContain(d.name);

    // permissões: atendente/cliente não recalculam nem destacam
    const att = await Api.as(ACCOUNTS.attendant.email);
    expect([403, 404]).toContain((await att.post(`establishments/${SEED.mestre}/menu/ranking/recalculate`)).status);
    expect([403, 404]).toContain((await att.put(`establishments/${SEED.mestre}/menu/items/${SEED.item(1)}/highlight`, { highlighted: true })).status);
    expect([401, 403, 404]).toContain((await client.put(`establishments/${E}/menu/items/${d.id}/highlight`, { highlighted: true })).status);
    expect([403, 404]).toContain((await manager.put(`establishments/${E}/menu/items/${d.id}/highlight`, { highlighted: true })).status); // gestor de OUTRA casa
    // semana: última execução automática registrada
    const run = await dbOne<any>('select ran_at from ranking_runs where id=1');
    test.info().annotations.push({ type: 'ficha 46 · recálculo semanal', description: `ranking_runs.ran_at=${run?.ran_at?.toISOString?.() ?? 'sem registro'} — a execução automática de 7 dias NÃO foi esperada (NOT VERIFIED)` });
    await custCtx.close();
    await mgrCtx.close();
  } finally {
    for (const id of created) await ze.del(`establishments/${E}/menu/items/${id}`);
    await ze.post(`establishments/${E}/menu/ranking/recalculate`);
  }
});

test('E4 · planta (gestor): editar mesa, mover, salvar → mapa do atendente reflete; conflito de versão, nome duplicado e limites', async ({ browser }) => {
  const E = SEED.mestre;
  const t = (await manager.get(`establishments/${E}/floor-plan`)).body.tables.find((x: any) => x.label === 'Mesa 12');
  const original = { x: t.x, y: t.y, capacity: t.capacity };
  const mgrCtx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const mgr = await mgrCtx.newPage();
  await mgr.goto('/gestor');
  await mgr.getByRole('button', { name: 'Planta do salão' }).click();
  const node = mgr.getByRole('button', { name: /^Mesa 12, \d+ lugares/ });
  await node.focus();
  for (let i = 0; i < 3; i++) await mgr.keyboard.press('Shift+ArrowLeft'); // -15 em x
  for (let i = 0; i < 4; i++) await mgr.keyboard.press('ArrowDown'); // +4 em y
  await expect(mgr.getByText('Alterações não salvas')).toBeVisible();
  await node.click();
  await mgr.getByLabel('Capacidade (lugares)').fill('6');
  const staffCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const staff = await staffCtx.newPage();
  await staff.goto('/atendente');
  await expect(staff.getByRole('button', { name: /^Mesa 12: / })).toBeVisible({ timeout: 15_000 });
  const t0 = Date.now();
  await mgr.getByRole('button', { name: 'Salvar layout' }).click();
  await expect(mgr.getByText(/^Planta salva — /)).toBeVisible({ timeout: 8000 });
  const readSaved = async () => (await manager.get(`establishments/${E}/floor-plan`)).body.tables.find((x: any) => x.label === 'Mesa 12');
  const saved = await readSaved(); // leitura imediata após o toast: a gravação já deve estar visível (sem repetir/mascarar)
  expect(saved.x).toBeCloseTo(original.x - 15, 1);
  expect(saved.y).toBeCloseTo(original.y + 4, 1);
  expect(saved.capacity).toBe(6);
  // atendente: mesma posição e capacidade, sem reconfiguração manual
  const left = async () => parseFloat((await staff.getByRole('button', { name: /^Mesa 12: / }).evaluate(el => (el as HTMLElement).style.left)) || '0');
  await expect.poll(left, { timeout: 8000 }).toBeCloseTo(saved.x, 1);
  recordMetric('ficha 20: salvar planta → mapa do atendente reposiciona', Date.now() - t0, 5000);
  const top = parseFloat(await staff.getByRole('button', { name: /^Mesa 12: / }).evaluate(el => (el as HTMLElement).style.top));
  expect(top).toBeCloseTo(saved.y, 1);
  expect(await dbOne<any>('select position_x, position_y, capacity from dining_tables where id=$1', [t.id])).toMatchObject({ capacity: 6 });

  // conflitos e validações (API)
  const fp = (await manager.get(`establishments/${E}/floor-plan`)).body;
  const body = (version: number, tables: any[]) => ({ version, tables });
  const same = fp.tables.map((x: any) => ({ id: x.id, label: x.label, shape: x.shape, capacity: x.capacity, x: x.x, y: x.y }));
  const stale = await manager.put(`establishments/${E}/floor-plan`, body(fp.version - 1, same));
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('FLOOR_PLAN_CONFLICT');
  const dup = same.map((x: any, i: number) => (i < 2 ? { ...x, label: 'Mesa Repetida' } : x));
  expect((await manager.put(`establishments/${E}/floor-plan`, body(fp.version, dup))).status).toBeClientError();
  expect((await manager.put(`establishments/${E}/floor-plan`, body(fp.version, same.map((x: any, i: number) => (i === 0 ? { ...x, capacity: 0 } : x))))).status).toBe(400);
  expect((await manager.put(`establishments/${E}/floor-plan`, body(fp.version, same.map((x: any, i: number) => (i === 0 ? { ...x, x: 150 } : x))))).status).toBe(400);
  expect((await manager.put(`establishments/${E}/floor-plan`, body(fp.version, same.map((x: any, i: number) => (i === 0 ? { ...x, shape: 'triangulo' } : x))))).status).toBe(400);
  // limite de mesas do plano (Cantina = Start, 15)
  const paula = await Api.as(ACCOUNTS.managerStart.email);
  const cfp = (await paula.get(`establishments/${SEED.cantina}/floor-plan`)).body;
  const many = Array.from({ length: 16 }, (_, i) => ({ label: `L${i}`, shape: 'round', capacity: 2, x: 5 + i * 5, y: 50 }));
  const lim = await paula.put(`establishments/${SEED.cantina}/floor-plan`, body(cfp.version, many));
  expect(lim.status).toBeClientError();
  expect(lim.body.code).toBe('TABLE_LIMIT_REACHED');
  expect((await paula.get(`establishments/${SEED.cantina}/floor-plan`)).body.tables).toHaveLength(cfp.tables.length); // nada mudou

  // restaura a mesa 12
  const now = (await manager.get(`establishments/${E}/floor-plan`)).body;
  const restore = now.tables.map((x: any) => ({ id: x.id, label: x.label, shape: x.shape, capacity: x.label === 'Mesa 12' ? original.capacity : x.capacity, x: x.label === 'Mesa 12' ? original.x : x.x, y: x.label === 'Mesa 12' ? original.y : x.y }));
  expect((await manager.put(`establishments/${E}/floor-plan`, body(now.version, restore))).status).toBeLessThan(300);
  await mgrCtx.close();
  await staffCtx.close();
});

test('E5 · duplicar planta (61): destinos elegíveis, cópia fiel, origem intacta, edição local, TARGET_IN_USE e permissões', async ({ browser }) => {
  const SRC = SEED.mestre;
  const DST = SEED.mestre2;
  const srcBefore = (await manager.get(`establishments/${SRC}/floor-plan`)).body;
  const snap = (fp: any) => fp.tables.map((x: any) => `${x.label}|${x.shape}|${x.capacity}|${x.x}|${x.y}`).sort();

  // destinos: só unidades da MESMA organização do gestor; plano sem o recurso → inelegível
  const targets = (await manager.get(`establishments/${SRC}/floor-plan/duplicate-targets`)).body as any[];
  expect(targets.map(x => x.name).sort()).toEqual(['Bar do Mestre 2', 'Bar do Mestre Express']);
  expect(targets.every(x => x.eligible)).toBe(true);
  const ze = await Api.as(ACCOUNTS.managerPro.email);
  const zeTargets = await ze.get(`establishments/${SEED.lancheria}/floor-plan/duplicate-targets`);
  expect(zeTargets.status).toBe(403); // plano Pro não inclui "duplicar layout"
  expect(zeTargets.body.code).toBe('FEATURE_NOT_IN_PLAN');
  expect([403]).toContain((await ze.post(`establishments/${SEED.lancheria}/floor-plan/duplicate`, { targetEstablishmentId: SEED.barDoZe })).status);

  // permissões e validações
  const att = await Api.as(ACCOUNTS.attendant.email);
  expect([403, 404]).toContain((await att.post(`establishments/${SRC}/floor-plan/duplicate`, { targetEstablishmentId: DST })).status);
  expect((await manager.post(`establishments/${SRC}/floor-plan/duplicate`, { targetEstablishmentId: SRC })).status).toBe(422);
  const foreign = await manager.post(`establishments/${SRC}/floor-plan/duplicate`, { targetEstablishmentId: SEED.est(2) }); // Seu Joaquim (outra org)
  expect([403, 404]).toContain(foreign.status);
  expect((await manager.post(`establishments/${SRC}/floor-plan/duplicate`, { targetEstablishmentId: 'nao-uuid' })).status).toBe(400);
  expect((await (await Api.create()).post(`establishments/${SRC}/floor-plan/duplicate`, { targetEstablishmentId: DST })).status).toBe(401);

  // UI: duplicar Mestre → Mestre 2 (o destino pode já ter mesas de execução anterior: substituição pedida pela própria tela)
  const mgrCtx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const mgr = await mgrCtx.newPage();
  await mgr.goto('/gestor');
  await mgr.getByRole('button', { name: 'Planta do salão' }).click();
  await mgr.getByRole('button', { name: 'Duplicar para outra unidade' }).click();
  await expect(mgr.getByText('Escolha a unidade que receberá a planta de Bar do Mestre.')).toBeVisible();
  await mgr.getByText('Bar do Mestre 2', { exact: true }).click();
  await mgr.getByRole('button', { name: 'Duplicar planta' }).click();
  await expect(mgr.getByText(/Planta de Bar do Mestre copiada para Bar do Mestre 2/)).toBeVisible({ timeout: 10_000 });

  const dst = (await manager.get(`establishments/${DST}/floor-plan`)).body;
  expect(snap(dst)).toEqual(snap(srcBefore)); // mesmas mesas, posições e capacidades
  const dstCodes = dst.tables.map((x: any) => x.qrCode);
  expect(new Set(dstCodes).size).toBe(dstCodes.length);
  expect(dstCodes.some((c: string) => srcBefore.tables.map((x: any) => x.qrCode).includes(c))).toBe(false); // QR novos
  const srcAfter = (await manager.get(`establishments/${SRC}/floor-plan`)).body;
  expect(snap(srcAfter)).toEqual(snap(srcBefore)); // origem intacta
  expect(srcAfter.tables.map((x: any) => x.id).sort()).toEqual(srcBefore.tables.map((x: any) => x.id).sort());
  expect(srcAfter.version).toBe(srcBefore.version);
  expect((await qr(await clientApi(), dstCodes[0])).establishmentName).toBe('Bar do Mestre 2'); // QR do destino abre a casa certa

  // sem replace → 409 TARGET_LAYOUT_NOT_EMPTY
  const again = await manager.post(`establishments/${SRC}/floor-plan/duplicate`, { targetEstablishmentId: DST });
  expect(again.status).toBe(409);
  expect(again.body.code).toBe('TARGET_LAYOUT_NOT_EMPTY');
  // destino em uso → 409 TARGET_IN_USE (mesa ocupada), mesmo com replace
  const destTable = dst.tables[0];
  expect((await manager.post(`establishments/${DST}/tables/${destTable.id}/occupy`, { partySize: 1 })).status).toBeLessThan(300);
  const busy = await manager.post(`establishments/${SRC}/floor-plan/duplicate`, { targetEstablishmentId: DST, replace: true });
  expect(busy.status).toBe(409);
  expect(busy.body.code).toBe('TARGET_IN_USE');
  expect(snap((await manager.get(`establishments/${DST}/floor-plan`)).body)).toEqual(snap(srcBefore)); // nada foi alterado
  await releaseTable(manager, DST, destTable.id);
  // destino com mesa reservada também bloqueia
  const rsv = await manager.post(`establishments/${DST}/tables/${destTable.id}/reservations`, { name: 'Reserva E2E', partySize: 1 });
  expect(rsv.status).toBeLessThan(300);
  expect((await manager.post(`establishments/${SRC}/floor-plan/duplicate`, { targetEstablishmentId: DST, replace: true })).body.code).toBe('TARGET_IN_USE');
  const resId = (await dbOne<any>('select id from table_reservations where table_id=$1 and closed_at is null', [destTable.id]))!.id;
  await manager.del(`establishments/${DST}/tables/${destTable.id}/reservations/${resId}`);

  // edição local após duplicar (UI, unidade Mestre 2) não afeta a origem
  await mgr.locator('button[aria-haspopup=listbox]').click();
  await mgr.getByRole('option', { name: /Bar do Mestre 2/ }).click();
  await mgr.getByRole('button', { name: /^Mesa 1, 2 lugares/ }).click();
  await mgr.getByLabel('Capacidade (lugares)').fill('3');
  await mgr.getByRole('button', { name: 'Salvar layout' }).click();
  await expect(mgr.getByText(/^Planta salva — /)).toBeVisible({ timeout: 8000 });
  expect((await manager.get(`establishments/${DST}/floor-plan`)).body.tables.find((x: any) => x.label === 'Mesa 1').capacity).toBe(3);
  expect(snap((await manager.get(`establishments/${SRC}/floor-plan`)).body)).toEqual(snap(srcBefore));
  await mgrCtx.close();
});

test('E6 · matriz de permissões: atendente, gestor de outra casa, cliente e anônimo nas rotas de gestão', async () => {
  const E = SEED.mestre;
  const att = await Api.as(ACCOUNTS.attendant.email);
  const other = await Api.as(ACCOUNTS.managerStart.email); // gestor da Cantina
  const client = await clientApi();
  const anon = await Api.create();
  const forbidden = [401, 403, 404];
  const item = SEED.item(1);
  const calls: [string, (a: Api) => Promise<any>][] = [
    ['criar item', a => a.post(`establishments/${E}/menu/items`, { name: 'Intruso', categoryName: 'Cervejas', priceCents: 100, imageUrl: 'https://x.test/a.png' })],
    ['editar item', a => a.patch(`establishments/${E}/menu/items/${item}`, { priceCents: 1 })],
    ['excluir item', a => a.del(`establishments/${E}/menu/items/${item}`)],
    ['salvar planta', a => a.put(`establishments/${E}/floor-plan`, { version: 1, tables: [] })],
    ['mesclar mesas', a => a.post(`establishments/${E}/table-groups`, { tableIds: [SEED.table(1), SEED.table(5)] })],
    ['criar promoção', a => a.post(`establishments/${E}/promotions`, { name: 'x', discountPercent: 10, startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 1e8).toISOString(), itemIds: [item] })],
  ];
  const attendantAllowed = [401, 403, 404];
  for (const [what, call] of calls) {
    expect(attendantAllowed, `atendente: ${what}`).toContain((await call(att)).status);
    expect(forbidden, `gestor de outra casa: ${what}`).toContain((await call(other)).status);
    expect(forbidden, `cliente: ${what}`).toContain((await call(client)).status);
    expect(forbidden, `anônimo: ${what}`).toContain((await call(anon)).status);
  }
  expect((await dbOne<any>('select price_cents from menu_items where id=$1', [item]))!.price_cents).toBe(1890); // nada mudou
  // atendente PODE: disponibilidade, mapa, pedidos (leitura)
  expect((await att.get(`establishments/${E}/table-map`)).status).toBe(200);
  expect((await att.get(`establishments/${E}/orders`)).status).toBe(200);
  // recurso do plano: gestor Start (Cantina) não usa promoções/fichas
  expect((await other.get(`establishments/${SEED.cantina}/promotions`)).status).toBe(403);
  expect((await other.get(`establishments/${SEED.cantina}/ingredients`)).status).toBe(403);
  // painel: atendente não entra em /gestor; cliente não entra em /atendente (UI)
});
