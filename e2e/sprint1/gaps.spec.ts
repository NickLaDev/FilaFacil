import { expect, test, type Page } from '@playwright/test';
import { Api, createOrder, menuItems, payApproved } from '../support/api';
import { MOBILE, brl, nav, newClientContext, newStaffContext } from '../support/ui';
import { ACCOUNTS, QR, SEED, WEB_URL } from '../support/env';
import { dbOne, dbQuery } from '../support/db';
import { clientApi, createDisposableAccount, managerApi, releaseTable, tableMap, uniq } from '../support/domain';
import { logSince } from '../support/log';
import { otpMark } from '../support/otp';
import { recordMetric } from '../support/metrics';

// Lacunas de cobertura identificadas na auditoria (e2e/COBERTURA.md): geolocalização e filtros da ficha 11, etc.

const BARAO = { latitude: -22.8213, longitude: -47.0794 }; // Barão Geraldo, Campinas (mesma região da lista do app)

/** Posição vertical (px) de cada nome na lista renderizada; prova a ORDEM exibida ao cliente. */
async function renderedOrder(page: Page, names: string[]) {
  const ys: [string, number][] = [];
  for (const name of names) {
    const box = await page.getByText(name, { exact: true }).first().boundingBox();
    if (box) ys.push([name, box.y]);
  }
  return ys.sort((a, b) => a[1] - b[1]).map(([n]) => n);
}

test('S1-11b · geolocalização do aparelho, filtros "Mais próximos"/"Menor espera"/"Aberto agora" e recusa de permissão', async ({ browser }) => {
  const anon = await Api.create();
  const ctx = await browser.newContext({ viewport: MOBILE, locale: 'pt-BR', baseURL: WEB_URL, geolocation: BARAO, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Explorar restaurantes' }).click();
  await page.getByRole('button', { name: /Campinas, SP/ }).first().click(); // região padrão → tela de localização
  const geoReq = page.waitForRequest(r => r.url().includes('/api/restaurants?') && r.url().includes('lat=-22.8213'), { timeout: 15_000 });
  await page.getByRole('button', { name: 'Usar minha localização' }).click();
  await expect(page.getByText('Localização atualizada')).toBeVisible();
  const req = new URL((await geoReq).url());
  expect(Number(req.searchParams.get('lat'))).toBeCloseTo(BARAO.latitude, 4);
  expect(Number(req.searchParams.get('lng'))).toBeCloseTo(BARAO.longitude, 4);

  await expect(page.getByText(/estabelecimentos? encontrados?/)).toBeVisible();
  // ordem exibida = ordem por distância da API para a MESMA coordenada
  const byDistance = (await anon.get('restaurants', { lat: BARAO.latitude, lng: BARAO.longitude, sort: 'distance', radiusKm: 50 })).body.items;
  const apiNames: string[] = byDistance.map((r: any) => r.name);
  expect(byDistance.map((r: any) => r.distanceM)).toEqual([...byDistance.map((r: any) => r.distanceM)].sort((a: number, b: number) => a - b));
  const unique = apiNames.filter(n => apiNames.filter(m => m === n).length === 1 && !apiNames.some(m => m !== n && m.includes(n)));
  const shown = await renderedOrder(page, unique);
  expect(shown.length).toBeGreaterThan(2);
  expect(shown).toEqual(unique.filter(n => shown.includes(n)));

  // "Menor espera": o app pede sort=wait ao servidor e mostra em ordem crescente de espera
  const waitReq = page.waitForRequest(r => r.url().includes('/api/restaurants?') && r.url().includes('sort=wait'));
  await page.getByRole('button', { name: 'Menor espera', exact: true }).click();
  await waitReq;
  const byWait = (await anon.get('restaurants', { lat: BARAO.latitude, lng: BARAO.longitude, sort: 'wait', radiusKm: 50 })).body.items;
  const waits: number[] = byWait.map((r: any) => r.averageWaitMinutes);
  expect(waits).toEqual([...waits].sort((a, b) => a - b));
  const waitNames: string[] = byWait.filter((r: any) => r.orderingStatus !== 'closed').map((r: any) => r.name);
  const uniqueWait = waitNames.filter(n => waitNames.filter(m => m === n).length === 1 && !apiNames.some(m => m !== n && m.includes(n)));
  const shownWait = await renderedOrder(page, uniqueWait);
  expect(shownWait).toEqual(uniqueWait.filter(n => shownWait.includes(n)));

  // "Aberto agora": filtro enviado ao servidor; só há casas abertas na lista
  const openReq = page.waitForRequest(r => r.url().includes('/api/restaurants?') && r.url().includes('openNow=true'));
  await page.getByRole('button', { name: 'Aberto agora', exact: true }).click();
  await openReq;
  const open = (await anon.get('restaurants', { lat: BARAO.latitude, lng: BARAO.longitude, openNow: true, radiusKm: 50 })).body.items;
  expect(open.every((r: any) => r.isOpenNow)).toBe(true);
  await expect(page.getByText(`${open.length} estabelecimento${open.length === 1 ? '' : 's'} encontrado${open.length === 1 ? '' : 's'}`)).toBeVisible();
  await ctx.close();

  // permissão negada → mensagem honesta e escolha manual de região (sem quebrar a busca)
  const denied = await browser.newContext({ viewport: MOBILE, locale: 'pt-BR', baseURL: WEB_URL, permissions: [] });
  await denied.grantPermissions([]); // garante sem geolocalização
  const p2 = await denied.newPage();
  await p2.goto('/');
  await p2.getByRole('button', { name: 'Explorar restaurantes' }).click();
  await p2.getByRole('button', { name: /Campinas, SP/ }).first().click();
  await p2.getByRole('button', { name: 'Usar minha localização' }).click();
  await expect(p2.getByText('Não conseguimos acessar sua localização. Escolha a região manualmente.')).toBeVisible({ timeout: 15_000 });
  const cambuiReq = p2.waitForRequest(r => r.url().includes('/api/restaurants?') && r.url().includes('lat=-22.8936'));
  await p2.getByLabel('Região').fill('Cambuí');
  await p2.getByRole('button', { name: /Cambuí, Campinas/ }).click();
  await cambuiReq;
  await expect(p2.getByText(/estabelecimentos? encontrados?/)).toBeVisible();
  await denied.close();
});

test('S1-20b · planta: ARRASTAR com o mouse, trocar o formato e criar mesa pela UI; atendente vê posição/formato sem reconfigurar; remover mesa', async ({ browser }) => {
  const E = SEED.mestre;
  const mgrApi = await managerApi();
  const plan = async () => (await mgrApi.get(`establishments/${E}/floor-plan`)).body;
  const t0 = (await plan()).tables.find((x: any) => x.label === 'Mesa 12');
  const original = { x: t0.x, y: t0.y, shape: t0.shape, capacity: t0.capacity };
  const newName = `Mesa E2E ${uniq().slice(0, 4)}`;

  const mgrCtx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const mgr = await mgrCtx.newPage();
  const staffCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const staff = await staffCtx.newPage();
  try {
    await mgr.goto('/gestor');
    await mgr.getByRole('button', { name: 'Planta do salão' }).click();
    const node = mgr.getByRole('button', { name: /^Mesa 12, \d+ lugares/ });
    await expect(node).toBeVisible();
    const before = (await node.boundingBox())!;
    // arrastar de verdade (pointer events): +70 px em x, +35 px em y
    await mgr.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await mgr.mouse.down();
    await mgr.mouse.move(before.x + before.width / 2 + 35, before.y + before.height / 2 + 15, { steps: 5 });
    await mgr.mouse.move(before.x + before.width / 2 + 70, before.y + before.height / 2 + 35, { steps: 5 });
    await mgr.mouse.up();
    const after = (await node.boundingBox())!;
    expect(after.x - before.x).toBeGreaterThan(55);
    expect(after.y - before.y).toBeGreaterThan(25);
    await expect(mgr.getByText('Alterações não salvas')).toBeVisible();
    // formato pela UI
    await node.click();
    const targetShape = original.shape === 'square' ? 'rect' : 'square';
    await mgr.getByRole('button', { name: targetShape === 'square' ? 'Quadrada' : 'Retangular', exact: true }).click();
    // nova mesa pela UI
    await mgr.getByRole('button', { name: 'Adicionar mesa' }).first().click();
    await mgr.getByLabel('Nome da mesa').fill(newName);
    await mgr.getByLabel('Capacidade (lugares)').fill('3');
    await mgr.getByRole('button', { name: 'Salvar layout' }).click();
    await expect(mgr.getByText(/^Planta salva — /)).toBeVisible({ timeout: 8000 });

    // persistência (API + banco)
    const fp = await plan();
    const moved = fp.tables.find((x: any) => x.label === 'Mesa 12');
    expect(moved.x).toBeGreaterThan(original.x + 3);
    expect(moved.y).toBeGreaterThan(original.y + 2);
    expect(moved.shape).toBe(targetShape);
    const created = fp.tables.find((x: any) => x.label === newName);
    expect(created, 'mesa nova criada').toBeTruthy();
    expect(created.capacity).toBe(3);
    expect(created.qrCode, 'mesa nova ganha QR único').toBeTruthy();
    const row = await dbOne<any>('select position_x, position_y, shape, capacity from dining_tables where id=$1', [created.id]);
    expect(row.capacity).toBe(3);

    // atendente: mapa mostra a nova mesa e a mesa movida na mesma posição, sem reconfiguração manual
    await staff.goto('/atendente');
    const nodeStaff = staff.getByRole('button', { name: /^Mesa 12: / });
    await expect(nodeStaff).toBeVisible({ timeout: 15_000 });
    await expect(staff.getByRole('button', { name: new RegExp(`^${newName}: `) })).toBeVisible();
    const left = parseFloat(await nodeStaff.evaluate(el => (el as HTMLElement).style.left));
    const top = parseFloat(await nodeStaff.evaluate(el => (el as HTMLElement).style.top));
    expect(left).toBeCloseTo(moved.x, 1);
    expect(top).toBeCloseTo(moved.y, 1);

    // remover a mesa nova pela UI (também persiste e some do mapa do atendente em tempo real)
    await mgr.getByRole('button', { name: new RegExp(`^${newName}, 3 lugares`) }).click();
    await mgr.getByRole('button', { name: /Remover mesa/ }).click();
    await mgr.getByRole('button', { name: 'Salvar layout' }).click();
    await expect.poll(async () => (await plan()).tables.some((x: any) => x.label === newName), { timeout: 8000 }).toBe(false);
    await expect(staff.getByRole('button', { name: new RegExp(`^${newName}: `) })).toHaveCount(0, { timeout: 8000 });
  } finally {
    const now = await plan();
    const restore = now.tables
      .filter((x: any) => x.label !== newName)
      .map((x: any) => (x.label === 'Mesa 12' ? { id: x.id, label: x.label, shape: original.shape, capacity: original.capacity, x: original.x, y: original.y } : { id: x.id, label: x.label, shape: x.shape, capacity: x.capacity, x: x.x, y: x.y }));
    await mgrApi.put(`establishments/${E}/floor-plan`, { version: now.version, tables: restore });
    await mgrCtx.close();
    await staffCtx.close();
  }
});

test('S1-21b · fila: só avisa quem CABE na mesa liberada, SMS (simulado, log de dev) em ≤ 10 s, sentar ocupa a mesa e o próximo compatível é avisado', async () => {
  const E = SEED.mestre;
  const mgr = await managerApi();
  const stamp = uniq().slice(0, 4);
  const last4 = () => String(1000 + Math.floor(Math.random() * 8999));
  const mk = (partySize: number, tail: string) => ({ name: `Gp${stamp} ${partySize}p${tail}`, phone: `(19) 9${last4().slice(0, 4)}-${tail}`, partySize });
  const entries = async () => (await mgr.get(`establishments/${E}/waitlist`)).body.entries as any[];
  // estado conhecido: fila do Bar do Mestre vazia (banco E2E; restos de outros testes)
  for (const e of await entries()) await mgr.del(`establishments/${E}/waitlist/${e.id}`);
  expect(await entries()).toHaveLength(0);

  const table = (await tableMap(mgr, E)).tables.find((x: any) => x.label === 'Mesa 1'); // 2 lugares
  expect(table.capacity).toBe(2);
  await releaseTable(mgr, E, table.id);
  expect((await mgr.post(`establishments/${E}/tables/${table.id}/occupy`, { partySize: 2 })).status).toBeLessThan(300);

  const big = mk(15, '1111');
  const duo = mk(2, '2222');
  const trio = mk(2, '3333');
  const created: any[] = [];
  for (const g of [big, duo, trio]) {
    const r = await mgr.post(`establishments/${E}/waitlist`, g);
    expect(r.status).toBe(201);
    created.push(r.body);
  }
  try {
    const list = await entries();
    expect(list.map(e => e.position)).toEqual([1, 2, 3]);
    for (const e of list) {
      expect(e.status).toBe('waiting');
      expect(typeof e.estimatedWaitMinutes, 'estimativa de espera presente').toBe('number');
    }
    // grupo maior espera mais ou igual (nenhuma mesa livre cabe 15; a estimativa nunca é menor que a de quem está atrás)
    // liberar a mesa de 2 lugares: o grupo de 15 NÃO cabe e é pulado; o primeiro que cabe (duo) é avisado
    const mark = otpMark();
    const t0 = Date.now();
    expect((await mgr.post(`establishments/${E}/tables/${table.id}/release`)).status).toBeLessThan(300);
    const sms = await waitForSms(mark, '2222');
    const ms = Date.now() - t0;
    recordMetric('ficha 21: liberar mesa compatível → SMS do próximo da fila no log de dev', ms, 10_000);
    expect(ms, 'ficha 21: aviso em até 10 s').toBeLessThanOrEqual(10_000);
    expect(sms).toContain('sua mesa está pronta (Mesa 1)');
    expect(sms).toContain(`Gp${stamp}`.split(' ')[0].slice(0, 6)); // primeiro nome do grupo
    expect(sms).not.toMatch(/\(19\) 9\d{4}-2222/); // telefone completo nunca no log (mascarado)
    const after = await entries();
    const byName = (n: string) => after.find(e => e.name === n)!;
    expect(byName(big.name).status).toBe('waiting');
    expect(byName(duo.name).status).toBe('notified');
    expect(byName(duo.name).notifiedTableLabel).toBe('Mesa 1');
    expect(byName(trio.name).status).toBe('waiting');
    const notif = await dbOne<any>("select channel, destination_masked, table_label, status, provider from waitlist_notifications where entry_id=$1 order by created_at desc limit 1", [byName(duo.name).id]);
    expect(notif).toMatchObject({ channel: 'sms', table_label: 'Mesa 1', provider: 'dev-log' });
    expect(notif.destination_masked).toMatch(/\*/);

    // sentar: o grupo sai da fila e a mesa avisada passa a ocupada com o tamanho do grupo
    expect((await mgr.post(`establishments/${E}/waitlist/${byName(duo.name).id}/seat`)).status).toBeLessThan(300);
    expect(await dbOne<any>('select occupancy, occupied_party_size from dining_tables where id=$1', [table.id])).toMatchObject({ occupancy: 'occupied', occupied_party_size: 2 });
    expect((await entries()).some(e => e.name === duo.name)).toBe(false);

    // liberar de novo: o próximo compatível (trio) é avisado; o de 15 continua esperando
    const mark2 = otpMark();
    expect((await mgr.post(`establishments/${E}/tables/${table.id}/release`)).status).toBeLessThan(300);
    await waitForSms(mark2, '3333');
    const fin = await entries();
    expect(fin.find(e => e.name === trio.name)!.status).toBe('notified');
    expect(fin.find(e => e.name === big.name)!.status).toBe('waiting');
    // permissão: cliente não consulta nem avisa
    expect([401, 403, 404]).toContain((await (await clientApi()).post(`establishments/${E}/waitlist/${byName(big.name).id}/notify`)).status);
  } finally {
    for (const e of await entries()) if (e.name.includes(`Gp${stamp}`)) await mgr.del(`establishments/${E}/waitlist/${e.id}`);
    await releaseTable(mgr, E, table.id);
  }
});

/** Linha "[SMS dev]" do log da API com destino terminado em `tail` (log só traz o celular mascarado). */
async function waitForSms(since: number, tail: string): Promise<string> {
  let found = '';
  await expect
    .poll(
      () => {
        const line = logSince(since).find(l => l.includes('[SMS dev]') && l.includes('-' + tail));
        found = line ?? '';
        return Boolean(line);
      },
      { timeout: 10_000, intervals: [100, 100, 200, 250] },
    )
    .toBe(true);
  return found;
}

/** "YYYY-MM-DDTHH:mm" no fuso local do navegador (America/Sao_Paulo), formato do <input type="datetime-local">. */
const localInput = (ms: number) => {
  const p = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  return p.replace(' ', 'T');
};

test('S1-29b · promoção pela TELA do gestor aparece no cardápio do cliente (selo e preço riscado) e ENCERRA SOZINHA ao fim do período (sem apagar)', async ({ browser }) => {
  const E = SEED.mestre;
  const mgrApi = await managerApi();
  const anon = await Api.create();
  const stamp = uniq().slice(0, 3);
  const uiName = `P${stamp}`;
  const day = 86_400_000;
  const batata = (await menuItems(anon, E)).find(i => i.name === 'Batata Frita');
  expect(batata.finalPriceCents).toBe(batata.priceCents);
  const mgrCtx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const mgr = await mgrCtx.newPage();
  const cliCtx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const cli = await cliCtx.newPage();
  let uiPromoId = '';
  try {
    await mgr.goto('/gestor');
    await mgr.getByRole('button', { name: 'Promoções' }).click();
    await mgr.getByRole('button', { name: /Nova promoção/ }).first().click();
    await mgr.getByLabel('Nome', { exact: true }).fill(uiName);
    await mgr.getByRole('checkbox', { name: /Batata Frita/ }).check();
    await mgr.getByLabel('Desconto (%)').fill('30');
    await mgr.getByLabel('Início', { exact: true }).fill(localInput(Date.now() - day));
    await mgr.getByLabel('Fim', { exact: true }).fill(localInput(Date.now() + 2 * day));
    const created = mgr.waitForResponse(r => r.url().includes(`/establishments/${E}/promotions`) && r.request().method() === 'POST');
    await mgr.getByRole('button', { name: /Criar|Salvar/ }).last().click();
    const res = await created;
    expect(res.status()).toBe(201);
    uiPromoId = (await res.json()).id;
    expect(await dbOne<any>('select discount_percent, name from promotions where id=$1', [uiPromoId])).toMatchObject({ discount_percent: 30, name: uiName });
    await expect(mgr.getByText(uiName).first()).toBeVisible();

    // cliente vê o selo e o preço com desconto (sem recarregar a API do cliente além da navegação normal)
    await cli.goto(`/?mesa=${QR.mesa1}`);
    await expect(cli.getByText('QR Code lido com sucesso')).toBeVisible({ timeout: 15_000 });
    await cli.getByRole('button', { name: 'Entrar no bar' }).click();
    await nav(cli, 'Cardápio');
    await cli.getByLabel('Buscar no cardápio').fill('Batata');
    await expect(cli.getByText(`${uiName} -30%`)).toBeVisible();
    await expect(cli.getByText(brl(batata.priceCents))).toBeVisible(); // preço original riscado
    await expect(cli.getByText(brl(Math.round(batata.priceCents * 0.7)))).toBeVisible();

    // remove a promoção da tela (volta ao preço cheio)
    await mgr.getByLabel(`Excluir ${uiName}`).click();
    await mgr.getByRole('button', { name: /Excluir|Confirmar|Remover/ }).last().click();
    await expect.poll(async () => (await dbOne('select 1 as x from promotions where id=$1', [uiPromoId])) === undefined, { timeout: 8000 }).toBe(true);
    uiPromoId = '';

    // encerramento automático: promoção que termina em ~6 s; NINGUÉM a apaga
    const short = await mgrApi.post(`establishments/${E}/promotions`, { name: `Curta${stamp}`, discountPercent: 40, startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 6_000).toISOString(), itemIds: [batata.id] });
    expect(short.status, JSON.stringify(short.body)).toBe(201);
    uiPromoId = short.body.id;
    const live = (await menuItems(anon, E)).find(i => i.name === 'Batata Frita');
    expect(live.finalPriceCents).toBe(Math.round(batata.priceCents * 0.6));
    expect(short.body.state).toBe('active');
    await expect.poll(async () => (await menuItems(anon, E)).find(i => i.name === 'Batata Frita').finalPriceCents, { timeout: 20_000, intervals: [500] }).toBe(batata.priceCents);
    expect(await dbOne('select 1 as x from promotions where id=$1', [uiPromoId]), 'a promoção continua cadastrada (só expirou)').toBeTruthy();
    const listed = (await mgrApi.get(`establishments/${E}/promotions`)).body;
    expect((listed.items ?? listed).find((p: any) => p.id === uiPromoId).state).toBe('expired');
    // e o cardápio do cliente, ao reabrir, não mostra mais o selo
    await cli.goto(`/?mesa=${QR.mesa1}`);
    await expect(cli.getByText('QR Code lido com sucesso')).toBeVisible({ timeout: 15_000 });
    await cli.getByRole('button', { name: 'Entrar no bar' }).click();
    await nav(cli, 'Cardápio');
    await cli.getByLabel('Buscar no cardápio').fill('Batata');
    await expect(cli.getByText('Batata Frita').first()).toBeVisible();
    await expect(cli.getByText(`Curta${stamp} -40%`)).toHaveCount(0);
  } finally {
    if (uiPromoId) await mgrApi.del(`establishments/${E}/promotions/${uiPromoId}`);
    await mgrCtx.close();
    await cliCtx.close();
  }
});

test('S1-31b · fichas técnicas pela TELA: alerta de custo acima do limite e recálculo de TODOS os pratos ao mudar o custo de um insumo', async ({ browser }) => {
  const E = SEED.mestre;
  const mgrApi = await managerApi();
  const sheetsOf = async () => {
    const b = (await mgrApi.get(`establishments/${E}/technical-sheets`)).body;
    return (b.items ?? b) as any[];
  };
  const ings = (await mgrApi.get(`establishments/${E}/ingredients`)).body;
  const hamb = (ings.items ?? ings).find((i: any) => i.name === 'Hambúrguer 180g');
  const oldCost = Number(hamb.unitCost);
  const using = (await sheetsOf()).filter((s: any) => (s.lines ?? s.ingredients ?? []).some((l: any) => (l.ingredientId ?? l.ingredient?.id) === hamb.id));
  expect(using.length, 'há ao menos um prato usando o insumo').toBeGreaterThan(0);
  const before = Object.fromEntries(using.map((s: any) => [s.menuItemName, Number(s.totalCost)]));

  const ctx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const page = await ctx.newPage();
  try {
    await page.goto('/gestor');
    await page.getByRole('button', { name: 'Fichas técnicas' }).click();
    await expect(page.getByText(/Custo acima do limite — \d+ prato\(s\)/)).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: 'X-Burger' });
    await expect(row.getByText('Acima do limite')).toBeVisible();
    await expect(row).toContainText('R$ 11,40'); // custo calculado pelo servidor (1×1,20+1×7,20+2×0,90+20×0,06)

    // muda o custo do insumo pela tela
    await page.getByRole('button', { name: /^Insumos/ }).click();
    await page.getByLabel('Editar Hambúrguer 180g').click();
    const put = page.waitForResponse(r => r.url().includes('/ingredients/') && r.request().method() === 'PATCH');
    await page.getByLabel(/^Custo por/).fill('1,00');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    expect((await put).status()).toBeLessThan(300);
    expect(Number((await dbOne<any>('select unit_cost from ingredients where id=$1', [hamb.id]))!.unit_cost)).toBeCloseTo(1, 2);

    // todos os pratos que usam o insumo foram recalculados (servidor) e a tela reflete: sem alerta no X-Burger
    for (const s of await sheetsOf()) if (before[s.menuItemName] !== undefined) expect(Number(s.totalCost), `${s.menuItemName} recalculado`).toBeLessThan(before[s.menuItemName]);
    await page.getByRole('button', { name: /^Fichas \(/ }).click();
    const row2 = page.getByRole('row').filter({ hasText: 'X-Burger' });
    await expect(row2).toContainText('R$ 5,20');
    await expect(row2.getByText('Acima do limite')).toHaveCount(0);
  } finally {
    await mgrApi.patch(`establishments/${E}/ingredients/${hamb.id}`, { unitCost: oldCost });
    await ctx.close();
  }
});

// ─── Ficha 12 · botão "Reservar" (reserva do cliente = entrada na fila de espera do restaurante) ──────────────────────

async function openRestaurantPage(page: Page, name: string) {
  await page.goto('/');
  const explore = page.getByRole('button', { name: 'Explorar restaurantes' });
  const tab = page.getByRole('navigation').getByRole('button', { name: 'Restaurantes' });
  await expect(explore.or(tab).first()).toBeVisible({ timeout: 15_000 }); // visitante vê "Explorar"; logado já vê a aba
  if (await explore.isVisible()) await explore.click();
  await page.getByRole('navigation').getByRole('button', { name: 'Restaurantes' }).dispatchEvent('click');
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Ver cardápio' })).toBeVisible();
}

test('S1-12 · "Reservar mesa": cliente reserva pela página do restaurante → estado na UI, linha na fila da equipe (tempo real), aviso de mesa pronta, cancelamento e negativas', async ({ browser }) => {
  const E = SEED.mestre;
  const mgr = await managerApi();
  const entries = async () => (await mgr.get(`establishments/${E}/waitlist`)).body.entries as any[];
  for (const e of await entries()) await mgr.del(`establishments/${E}/waitlist/${e.id}`); // fila conhecida (banco E2E)
  const joao = await clientApi(ACCOUNTS.client);
  const me = (await joao.get('me')).body.user;
  await joao.del(`restaurants/${E}/reservation`); // resto de execução anterior (404 se não houver)
  const resPath = `restaurants/${E}/reservation`;

  // equipe com a tela da fila aberta ANTES (prova de tempo real, sem recarregar)
  const staffCtx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const staff = await staffCtx.newPage();
  await staff.goto('/gestor');
  await staff.getByRole('button', { name: 'Fila de espera' }).click();
  await expect(staff.getByText('Total na fila')).toBeVisible({ timeout: 15_000 });

  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();
  try {
    // ── UI: botão presente na página, formulário, validação do tamanho do grupo
    await openRestaurantPage(page, 'Bar do Mestre');
    const reserveBtn = page.getByRole('button', { name: /Reservar mesa/ });
    await expect(reserveBtn).toBeEnabled();
    await reserveBtn.click();
    const sheet = page.getByRole('dialog', { name: 'Reservar mesa' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('party-size')).toHaveText('2');
    await expect(sheet.getByRole('button', { name: 'Menos uma pessoa' })).toBeEnabled();
    await sheet.getByRole('button', { name: 'Menos uma pessoa' }).click();
    await expect(sheet.getByTestId('party-size')).toHaveText('1');
    await expect(sheet.getByRole('button', { name: 'Menos uma pessoa' })).toBeDisabled(); // mínimo 1
    for (let i = 0; i < 3; i++) await sheet.getByRole('button', { name: 'Mais uma pessoa' }).click();
    await expect(sheet.getByTestId('party-size')).toHaveText('4');
    await expect(sheet.getByLabel(/Celular para o aviso/)).toHaveCount(0); // a conta já tem celular

    const posted = page.waitForResponse(r => r.url().includes(`/restaurants/${E}/reservation`) && r.request().method() === 'POST');
    const t0 = Date.now();
    await sheet.getByRole('button', { name: 'Confirmar reserva' }).click();
    const res = await posted;
    expect(res.status()).toBe(201);
    expect(res.request().postDataJSON()).toEqual({ partySize: 4 });
    const body = await res.json();
    expect(body).toMatchObject({ partySize: 4, status: 'waiting' });
    await expect(page.getByText('Reserva confirmada')).toBeVisible();
    await expect(sheet.getByTestId('reservation-status')).toContainText(/Você está na fila — posição 1/);
    await expect(sheet).toContainText('4 pessoas');

    // ── persistência: banco e API
    const row = await dbOne<any>("select party_size, status, customer_id, name, phone from waitlist_entries where id=$1", [body.id]);
    expect(row).toMatchObject({ party_size: 4, status: 'waiting', customer_id: me.id, name: me.name });
    expect((await joao.get(resPath)).body).toMatchObject({ hasPhone: true, reservation: { id: body.id, position: 1, partySize: 4 } });

    // ── equipe vê a reserva na fila SEM recarregar (permissão de gestor/atendente)
    const staffRow = staff.getByRole('row').filter({ hasText: me.name });
    await expect(staffRow).toBeVisible({ timeout: 8000 });
    await expect(staffRow.getByText('Reserva online')).toBeVisible();
    await expect(staffRow).toContainText('4 pessoas');
    recordMetric('ficha 12: cliente confirma reserva → aparece na fila da equipe', Date.now() - t0, 5000);
    const listed = (await entries()).find(e => e.id === body.id);
    expect(listed).toMatchObject({ partySize: 4, status: 'waiting', position: 1 });
    const attendant = await Api.as(ACCOUNTS.attendant.email);
    expect((await attendant.get(`establishments/${E}/waitlist`)).status, 'atendente sem permissão waitlist.manage não vê a fila').toBe(403);

    // botão da página reflete a reserva existente (fechar e reabrir a página)
    await sheet.getByRole('button', { name: 'Fechar' }).click();
    await expect(page.getByRole('button', { name: /Sua reserva · posição 1/ })).toBeVisible();

    // ── negativas (API real): duplicada, tamanho inválido, celular inválido, sem sessão, equipe não reserva
    const dup = await joao.post(resPath, { partySize: 2 });
    expect(dup.status).toBe(409);
    for (const bad of [0, 51, 2.5, -1, 'dois']) expect((await joao.post(resPath, { partySize: bad })).status, `partySize ${bad}`).toBe(400);
    expect((await (await Api.create()).post(resPath, { partySize: 2 })).status).toBe(401);
    expect((await mgr.post(resPath, { partySize: 2 })).status).toBe(403);
    expect((await (await Api.create()).get(resPath)).status).toBe(401);
    expect((await entries()).filter(e => e.customerId === me.id || e.name === me.name)).toHaveLength(1); // nada duplicado

    // ── aviso de mesa pronta: libera mesa compatível → cliente é notificado (SMS simulado) e vê na UI
    const table = (await tableMap(mgr, E)).tables.find((x: any) => x.label === 'Mesa 10'); // 6 lugares: cabe 4
    expect(table.capacity).toBeGreaterThanOrEqual(4);
    await mgr.post(`establishments/${E}/tables/${table.id}/occupy`, { partySize: 2 });
    const mark = otpMark();
    expect((await mgr.post(`establishments/${E}/tables/${table.id}/release`)).status).toBeLessThan(300);
    await expect.poll(async () => (await joao.get(resPath)).body.reservation?.status, { timeout: 10_000 }).toBe('notified');
    expect(logSince(mark).some(l => l.includes('[SMS dev]') && l.includes('-9999') && l.includes('sua mesa está pronta (Mesa 10)')), 'SMS (simulado) do aviso no log da API').toBe(true);
    await openRestaurantPage(page, 'Bar do Mestre');
    await page.getByRole('button', { name: /Sua reserva/ }).click();
    await expect(page.getByTestId('reservation-status')).toContainText('Sua mesa está pronta (Mesa 10)');

    // ── cancelar pela UI
    const del = page.waitForResponse(r => r.url().includes(`/restaurants/${E}/reservation`) && r.request().method() === 'DELETE');
    await page.getByRole('button', { name: 'Cancelar reserva' }).click();
    expect((await del).status()).toBe(204);
    await expect(page.getByText('Reserva cancelada')).toBeVisible();
    expect(await dbOne<any>('select status from waitlist_entries where id=$1', [body.id])).toMatchObject({ status: 'removed' });
    expect((await joao.get(resPath)).body.reservation).toBeNull();
    expect((await joao.del(resPath)).status).toBe(404); // já cancelada
    await expect(staff.getByRole('row').filter({ hasText: me.name })).toHaveCount(0, { timeout: 8000 });
    await mgr.post(`establishments/${E}/tables/${table.id}/release`);
  } finally {
    for (const e of await entries()) if (e.name === me.name) await mgr.del(`establishments/${E}/waitlist/${e.id}`);
    await ctx.close();
    await staffCtx.close();
  }
});

test('S1-12b · "Reservar": visitante é levado ao login; sem celular na conta o app pede (validado); casa fechada não aceita (UI desabilitada + API 409)', async ({ browser }) => {
  const E = SEED.mestre;
  // visitante
  const g = await browser.newContext({ viewport: MOBILE, locale: 'pt-BR', baseURL: WEB_URL });
  const gp = await g.newPage();
  await openRestaurantPage(gp, 'Bar do Mestre');
  await gp.getByRole('button', { name: /Reservar mesa/ }).click();
  await expect(gp.getByText('Entre na sua conta para reservar')).toBeVisible();
  await expect(gp.getByLabel('Celular ou e-mail')).toBeVisible(); // tela de login
  await g.close();

  // conta sem celular: o formulário pede e valida
  const mgr = await managerApi();
  const pedro = await clientApi(ACCOUNTS.clientNoPhone);
  expect((await pedro.get(`restaurants/${E}/reservation`)).body.hasPhone).toBe(false);
  const ctx = await newClientContext(browser, { email: ACCOUNTS.clientNoPhone.email });
  const page = await ctx.newPage();
  try {
    await openRestaurantPage(page, 'Bar do Mestre');
    await page.getByRole('button', { name: /Reservar mesa/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Reservar mesa' });
    await sheet.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(sheet.getByText('Informe um celular válido com DDD.')).toBeVisible();
    expect((await pedro.get(`restaurants/${E}/reservation`)).body.reservation).toBeNull(); // nada gravado
    expect((await pedro.post(`restaurants/${E}/reservation`, { partySize: 2, phone: '123' })).status).toBe(400);
    await sheet.getByLabel(/Celular para o aviso/).fill('(19) 97654-3210');
    await sheet.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(sheet.getByTestId('reservation-status')).toBeVisible();
    const mine = (await pedro.get(`restaurants/${E}/reservation`)).body.reservation;
    expect(mine).toMatchObject({ partySize: 2 });
    expect((await dbOne<any>('select phone from waitlist_entries where id=$1', [mine.id]))!.phone).toMatch(/9\d{4}-?3210|19976543210/);
    await sheet.getByRole('button', { name: 'Cancelar reserva' }).click();
    await expect(page.getByText('Reserva cancelada')).toBeVisible();
  } finally {
    await pedro.del(`restaurants/${E}/reservation`);
    await ctx.close();
  }

  // casa fechada (horário provocado na hora, restaurado no fim): UI desabilitada e API recusa
  const admin = await Api.as(ACCOUNTS.admin.email);
  const BM2 = SEED.mestre2;
  const allDay = [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, opensAt: '00:00', closesAt: '23:59' }));
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay();
  const otherDay = (today + 3) % 7;
  const joao = await clientApi(ACCOUNTS.client);
  const c2 = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const p2 = await c2.newPage();
  try {
    expect((await admin.patch(`admin/establishments/${BM2}`, { openingHours: [{ weekday: otherDay, opensAt: '00:00', closesAt: '23:59' }] })).status).toBeLessThan(300);
    expect((await Api.create().then(a => a.get(`restaurants/${BM2}`))).body.reservationsOpen).toBe(false);
    const r = await joao.post(`restaurants/${BM2}/reservation`, { partySize: 2 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('RESTAURANT_CLOSED');
    await openRestaurantPage(p2, 'Bar do Mestre 2');
    await expect(p2.getByRole('button', { name: /Reservar mesa/ })).toBeDisabled();
    await expect(p2.getByText('Reservas disponíveis quando o restaurante estiver aberto.')).toBeVisible();
    expect((await dbQuery("select 1 from waitlist_entries where establishment_id=$1 and customer_id is not null and status='waiting'", [BM2])).length).toBe(0);
  } finally {
    await admin.patch(`admin/establishments/${BM2}`, { openingHours: allDay });
    await c2.close();
  }
  void mgr;
});

test('S1-13c · perfil: trocar E-MAIL e CELULAR pela tela → persistidos, login passa a valer com o novo e-mail e o novo celular é usado na reserva seguinte', async ({ browser }) => {
  const E = SEED.mestre;
  const acc = await createDisposableAccount({ password: 'SenhaForte123' });
  const ctx = await newClientContext(browser, { email: acc.email, password: acc.password, fresh: true });
  const page = await ctx.newPage();
  const newEmail = `e2e-novo-${uniq()}@example.test`;
  const phone = `(19) 9${String(1000 + Math.floor(Math.random() * 8999))}-${String(1000 + Math.floor(Math.random() * 8999))}`;
  const mgr = await managerApi();
  try {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Início' })).toBeVisible({ timeout: 15_000 });
    await nav(page, 'Perfil');
    await page.getByRole('button', { name: 'Editar' }).click();
    await page.getByLabel('Celular').fill(phone);
    await page.getByLabel('E-mail').fill(newEmail);
    const patched = page.waitForResponse(r => r.url().endsWith('/api/me') && r.request().method() === 'PATCH');
    await page.getByRole('button', { name: /Salvar alterações/ }).click(); // clique real (S1-13b)
    expect((await patched).status()).toBe(200);
    await expect(page.getByText(/Dados salvos/)).toBeVisible();
    const row = await dbOne<any>('select email, phone, email_verified_at, phone_verified_at from users where id=$1', [acc.id]);
    expect(row.email).toBe(newEmail);
    expect(row.phone.replace(/\D/g, '')).toBe(phone.replace(/\D/g, ''));
    expect(row.email_verified_at, 'contato novo volta a exigir verificação').toBeNull();
    // login com o e-mail novo; o antigo não vale mais
    const anon = await Api.create();
    expect((await anon.post('auth/login', { email: newEmail, password: acc.password })).status).toBe(200);
    expect((await (await Api.create()).post('auth/login', { email: acc.email, password: acc.password })).status).toBe(401);
    // celular novo é o usado nas ações seguintes (reserva herda o telefone da conta)
    const me = await Api.fromBrowser(ctx);
    const state = (await me.get(`restaurants/${E}/reservation`)).body;
    expect(state.hasPhone).toBe(true);
    const r = await me.post(`restaurants/${E}/reservation`, { partySize: 2 });
    expect(r.status).toBe(201);
    expect((await dbOne<any>('select phone from waitlist_entries where id=$1', [r.body.id]))!.phone.replace(/\D/g, '')).toBe(phone.replace(/\D/g, ''));
    await me.del(`restaurants/${E}/reservation`);
  } finally {
    for (const e of (await mgr.get(`establishments/${E}/waitlist`)).body.entries as any[]) if (e.name === acc.name) await mgr.del(`establishments/${E}/waitlist/${e.id}`);
    await ctx.close();
  }
});

test('S1-34b · estabelecimento INATIVO/SUSPENSO deixa de aceitar pedidos imediatamente: pedido novo → 404, pedido não pago → 422 ESTABLISHMENT_NOT_ACCEPTING_ORDERS; reativado volta a aceitar', async () => {
  const E = SEED.mestre;
  const admin = await Api.as(ACCOUNTS.admin.email);
  const client = await clientApi(ACCOUNTS.client);
  const items = await menuItems(client, E);
  const item = items.find(i => i.available !== false) ?? items[0];
  const line = { menuItemId: item.id, quantity: 1 };
  try {
    for (const status of ['inactive', 'suspended'] as const) {
      const pending = await createOrder(client, { establishmentId: E, items: [line] }); // criado enquanto ativo (ainda não pago)
      expect(pending.status, JSON.stringify(pending.body)).toBe(201);
      expect((await admin.patch(`admin/establishments/${E}/status`, { status })).status).toBeLessThan(300);
      const fresh = await createOrder(client, { establishmentId: E, items: [line] });
      expect(fresh.status, `novo pedido com casa ${status}`).toBe(404);
      const pay = await payApproved(client, pending.body.id, pending.body.totalCents);
      expect(pay.status, `pagar pedido existente com casa ${status}`).toBe(422);
      expect(pay.body.code).toBe('ESTABLISHMENT_NOT_ACCEPTING_ORDERS');
      expect(await dbQuery("select 1 from payments where order_id=$1 and status='approved'", [pending.body.id]), 'nada cobrado').toHaveLength(0);
      expect((await (await Api.create()).get('restaurants')).body.items.map((r: any) => r.name)).not.toContain('Bar do Mestre');
      expect((await admin.patch(`admin/establishments/${E}/status`, { status: 'active' })).status).toBeLessThan(300);
    }
    const ok = await createOrder(client, { establishmentId: E, items: [line] });
    expect(ok.status).toBe(201); // reativado: aceita de novo
  } finally {
    await admin.patch(`admin/establishments/${E}/status`, { status: 'active' });
  }
});
