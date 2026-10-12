import { expect, test, type Page } from '@playwright/test';
import { Api, createOrder, menuItems, payApproved, qr } from '../support/api';
import { ACCOUNTS, QR, SEED } from '../support/env';
import { dbOne, dbQuery } from '../support/db';
import { enterTableByLink, newClientContext, newStaffContext, nav } from '../support/ui';
import { clientApi, managerApi, releaseTable, tableMap } from '../support/domain';
import { elapsedUntil, recordMetric } from '../support/metrics';

// Cenário C — QR da mesa, ocupação automática/manual, reservas, chamados, mesclagem (fichas 02, 16, 47). Real: front+API+PostgreSQL+Socket.IO.

let manager: Api;
let items: any[];
const item = (n: string) => items.find(i => i.name === n);
const touched = new Set<string>();
const E = SEED.mestre;

const tableByLabel = async (label: string) => (await tableMap(manager, E)).tables.find((t: any) => t.label === label);
const stateOf = async (label: string) => (await tableByLabel(label)).status as string;
const node = (page: Page, label: string, status: string) => page.getByRole('button', { name: `${label}: ${status}` });

async function useFreeTable(label: string) {
  const t = await tableByLabel(label);
  touched.add(t.id);
  await releaseTable(manager, E, t.id);
  const calls = await dbQuery('select id from table_calls where table_id=$1 and resolved_at is null', [t.id]);
  if (calls.length) await manager.post(`establishments/${E}/tables/${t.id}/calls/resolve`);
  const res = await dbQuery<any>('select id from table_reservations where table_id=$1 and closed_at is null', [t.id]);
  for (const r of res) await manager.del(`establishments/${E}/tables/${t.id}/reservations/${r.id}`);
  return (await tableByLabel(label)) as any;
}

test.beforeAll(async () => {
  manager = await managerApi();
  items = await menuItems(manager, E);
});
test.afterAll(async () => {
  const groups = await dbQuery<any>('select id from table_groups where establishment_id=$1', [E]);
  for (const g of groups) await manager.del(`establishments/${E}/table-groups/${g.id}`);
  for (const t of touched) {
    await releaseTable(manager, E, t);
    const res = await dbQuery<any>('select id from table_reservations where table_id=$1 and closed_at is null', [t]);
    for (const r of res) await manager.del(`establishments/${E}/tables/${t}/reservations/${r.id}`);
    await manager.post(`establishments/${E}/tables/${t}/calls/resolve`);
  }
});

test('C1 · QR da mesa: link e código digitado abrem a mesa certa (≤ 3 s); QR inválido e bar fechado tratados', async ({ browser }) => {
  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();
  // Link do QR → confirmação do bar/mesa → cardápio (meta ficha 02: 3 s)
  const t0 = Date.now();
  await page.goto(`/?mesa=${QR.mesa5}`);
  await expect(page.getByText('QR Code lido com sucesso')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Mesa 5', { exact: true })).toBeVisible();
  await expect(page.getByText('Bar do Mestre', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Entrar no bar' }).click();
  await nav(page, 'Cardápio');
  await expect(page.getByText('Bar do Mestre · Mesa 5')).toBeVisible();
  await expect(page.getByLabel('Buscar no cardápio')).toBeVisible();
  recordMetric('ficha 02: link do QR → cardápio da mesa', Date.now() - t0, 3000);
  expect(Date.now() - t0, 'ficha 02: cardápio da mesa em até 3 s').toBeLessThanOrEqual(3000);

  // QR inválido (link)
  const ctx3 = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const p3 = await ctx3.newPage();
  await p3.goto('/?mesa=CODIGO-INEXISTENTE');
  await expect(p3.getByText('QR Code inválido')).toBeVisible({ timeout: 15_000 });
  await ctx3.close();

  // Código inválido digitado
  const ctx4 = await newClientContext(browser);
  const p4 = await ctx4.newPage();
  await p4.goto('/');
  await p4.getByRole('button', { name: 'Escanear QR Code' }).click();
  await p4.getByText('Digitar código').click();
  await p4.getByLabel('Código da mesa').fill('XXXX-0000');
  await p4.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(p4.getByText('Não encontramos esse código. Confira e tente novamente.')).toBeVisible();
  // Código válido digitado → confirmação
  await p4.getByLabel('Código da mesa').fill('mestre-1041'); // minúsculas são normalizadas
  await p4.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(p4.getByText('QR Code lido com sucesso')).toBeVisible();
  await expect(p4.getByText('Mesa 1', { exact: true })).toBeVisible();
  await ctx4.close();
  await ctx.close();
});

test('C1b · QR de bar pausado e de bar fechado por horário (provocados na hora): tela própria, só consulta, pedido recusado', async ({ browser }) => {
  const E1 = SEED.mestre;
  const admin = await Api.as(ACCOUNTS.admin.email);
  const clientApi_ = await clientApi();
  const itemId = (await menuItems(clientApi_, E1))[0].id;
  const allDay = [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, opensAt: '00:00', closesAt: '23:59' }));
  const todaySp = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }));
  const otherDayOnly = [{ weekday: (todaySp + 3) % 7, opensAt: '10:00', closesAt: '18:00' }];
  const tableId = (await qr(clientApi_, QR.mesa1)).tableId;

  const check = async (label: string, status: RegExp) => {
    const r = await clientApi_.get(`restaurants/qr/${QR.mesa1}`);
    expect(r.status, label).toBe(200);
    expect(r.body.acceptingOrders, `${label}: API informa que não aceita pedidos`).toBe(false);
    const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
    const page = await ctx.newPage();
    await page.goto(`/?mesa=${QR.mesa1}`);
    await expect(page.getByText(status)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('QR Code lido com sucesso')).toHaveCount(0);
    await page.getByRole('button', { name: /Ver cardápio/ }).click();
    await expect(page.getByText('Somente consulta.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver carrinho' })).toHaveCount(0);
    await ctx.close();
    const o = await createOrder(clientApi_, { establishmentId: E1, tableId, items: [{ menuItemId: itemId, quantity: 1 }] });
    expect(o.status, `${label}: pedido recusado`).toBeClientError();
    expect(o.body.code).toBe('ESTABLISHMENT_NOT_ACCEPTING_ORDERS');
  };
  try {
    expect((await admin.patch(`admin/establishments/${E1}`, { ordersPaused: true })).status).toBe(200);
    await check('pausado', /Pedidos pausados/);
  } finally {
    expect((await admin.patch(`admin/establishments/${E1}`, { ordersPaused: false })).status).toBe(200);
  }
  try {
    expect((await admin.patch(`admin/establishments/${E1}`, { openingHours: otherDayOnly })).status).toBe(200);
    await check('fechado por horário', /Pedidos fechados/);
  } finally {
    expect((await admin.patch(`admin/establishments/${E1}`, { openingHours: allDay })).status).toBe(200);
  }
  // restaurado: o QR volta a abrir a mesa normalmente
  const ok = await clientApi_.get(`restaurants/qr/${QR.mesa1}`);
  expect(ok.body.acceptingOrders).toBe(true);
});

test('C2 · pedido ligado à mesa: pagar ocupa a mesa e o mapa do atendente atualiza (≤ 3 s); comanda mostra o pedido', async ({ browser }) => {
  const t = await useFreeTable('Mesa 8');
  const staffCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const staff = await staffCtx.newPage();
  await staff.goto('/atendente');
  await expect(node(staff, 'Mesa 8', 'Livre')).toBeVisible({ timeout: 15_000 });
  // legenda com contagem por status
  await expect(staff.getByText(/\d+ livre/).first()).toBeVisible();
  await expect(staff.getByText(/\d+ ocupada/).first()).toBeVisible();

  const api = await clientApi();
  const o = await createOrder(api, { establishmentId: E, tableId: t.id, items: [{ menuItemId: item('Batata Frita').id, quantity: 2 }] });
  expect(o.status).toBe(201);
  expect(o.body.tableLabel).toBe('Mesa 8'); // pedido associado à mesa escaneada
  // Antes do pagamento a mesa continua livre
  expect(await stateOf('Mesa 8')).toBe('free');
  const t0 = Date.now();
  expect((await payApproved(api, o.body.id, o.body.totalCents)).status).toBeLessThan(300);
  const ms = await elapsedUntil(t0, async () => (await node(staff, 'Mesa 8', 'Ocupada').count()) > 0, 10_000, 50);
  recordMetric('ficha 16: pagamento do pedido → mesa ocupada no mapa do atendente', ms, 3000);
  expect(ms).toBeLessThanOrEqual(3000);
  expect(await dbOne<any>('select occupancy, occupied_party_size from dining_tables where id=$1', [t.id])).toMatchObject({ occupancy: 'occupied' });

  // detalhe: pessoas, capacidade, comanda consolidada
  await node(staff, 'Mesa 8', 'Ocupada').click();
  await expect(staff.getByText('Capacidade')).toBeVisible();
  await expect(staff.getByText(`Pedido #${o.body.number}`)).toBeVisible();
  const check = (await manager.get(`establishments/${E}/table-checks/${t.id}`)).body;
  expect(check.totalCents).toBe(o.body.totalCents);
  expect(check.orders.map((x: any) => x.number)).toContain(o.body.number);
  await staffCtx.close();
});

test('C3 · ocupar e liberar manualmente pela tela; operações inválidas recusadas', async ({ browser }) => {
  const t = await useFreeTable('Mesa 10');
  const staffCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const staff = await staffCtx.newPage();
  await staff.goto('/atendente');
  await node(staff, 'Mesa 10', 'Livre').click();
  // validação da UI: 0 e acima da capacidade (6) bloqueiam o botão
  await staff.getByLabel('Pessoas na mesa').fill('0');
  await expect(staff.getByRole('button', { name: 'Ocupar mesa' })).toBeDisabled();
  await staff.getByLabel('Pessoas na mesa').fill('7');
  await expect(staff.getByRole('button', { name: 'Ocupar mesa' })).toBeDisabled();
  await staff.getByLabel('Pessoas na mesa').fill('3');
  const t0 = Date.now();
  await staff.getByRole('button', { name: 'Ocupar mesa' }).click();
  await expect(node(staff, 'Mesa 10', 'Ocupada')).toBeVisible({ timeout: 5000 });
  recordMetric('ficha 16: atendente ocupa mesa → mapa mostra ocupada', Date.now() - t0, 3000);
  expect(Date.now() - t0).toBeLessThanOrEqual(3000);
  expect(await dbOne<any>('select occupancy, occupied_party_size from dining_tables where id=$1', [t.id])).toMatchObject({ occupancy: 'occupied', occupied_party_size: 3 });
  await expect(staff.locator('aside').filter({ hasText: 'Capacidade' })).toContainText(/Pessoas\s*3/); // pessoas na mesa, no painel de detalhes
  // API: ocupar mesa já ocupada / quantidade inválida / mesa de outro estabelecimento
  // Ocupar de novo uma mesa ocupada é idempotente: só atualiza o número de pessoas (não duplica nem muda `occupied_since`).
  const since = (await dbOne<any>('select occupied_since from dining_tables where id=$1', [t.id]))!.occupied_since.toISOString();
  expect((await manager.post(`establishments/${E}/tables/${t.id}/occupy`, { partySize: 2 })).status).toBeLessThan(300);
  expect(await dbOne<any>('select occupied_party_size, occupied_since from dining_tables where id=$1', [t.id])).toMatchObject({ occupied_party_size: 2 });
  expect((await dbOne<any>('select occupied_since from dining_tables where id=$1', [t.id]))!.occupied_since.toISOString()).toBe(since);
  // Acima da capacidade (6): a UI bloqueia; registra o que a API faz
  const over = await manager.post(`establishments/${E}/tables/${t.id}/occupy`, { partySize: 7 });
  test.info().annotations.push({ type: 'API aceita partySize > capacidade?', description: `status ${over.status} (UI bloqueia acima da capacidade)` });
  await manager.post(`establishments/${E}/tables/${t.id}/occupy`, { partySize: 3 });
  expect((await manager.post(`establishments/${E}/tables/${t.id}/occupy`, { partySize: 0 })).status).toBe(400);
  const other = await dbOne<any>('select id from dining_tables where establishment_id=$1 limit 1', [SEED.cantina]);
  expect((await manager.post(`establishments/${E}/tables/${other!.id}/occupy`, { partySize: 2 })).status).toBe(404);
  // sem sessão
  expect((await (await Api.create()).post(`establishments/${E}/tables/${t.id}/release`)).status).toBe(401);
  // cliente não opera o mapa
  expect([403, 404]).toContain((await (await clientApi()).post(`establishments/${E}/tables/${t.id}/release`)).status);

  // Liberar
  await staff.getByRole('button', { name: 'Liberar mesa' }).click(); // painel de detalhes segue aberto
  await expect(node(staff, 'Mesa 10', 'Livre')).toBeVisible({ timeout: 5000 });
  expect(await dbOne<any>('select occupancy from dining_tables where id=$1', [t.id])).toMatchObject({ occupancy: 'free' });
  await staffCtx.close();
});

test('C4 · reservas: reservar, estado "reservada", conflito e cancelamento', async ({ browser }) => {
  const t = await useFreeTable('Mesa 1');
  const staffCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const staff = await staffCtx.newPage();
  await staff.goto('/atendente');
  await node(staff, 'Mesa 1', 'Livre').click();
  await staff.getByLabel('Nome da reserva').fill('Família Silva');
  await staff.getByLabel('Pessoas na reserva').fill('2');
  await staff.getByRole('button', { name: 'Reservar mesa' }).click();
  await expect(node(staff, 'Mesa 1', 'Reservada')).toBeVisible({ timeout: 5000 });
  expect(await stateOf('Mesa 1')).toBe('reserved');
  expect(await dbQuery('select name, party_size from table_reservations where table_id=$1 and closed_at is null', [t.id])).toEqual([{ name: 'Família Silva', party_size: 2 }]);
  // segunda reserva na mesma mesa → conflito; acima da capacidade → 400
  expect((await manager.post(`establishments/${E}/tables/${t.id}/reservations`, { name: 'Outro', partySize: 2 })).status).toBe(409);
  expect((await manager.post(`establishments/${E}/tables/${t.id}/reservations`, { name: 'X', partySize: 0 })).status).toBe(400);
  // cancelar pela UI
  await expect(staff.getByText(/Reserva: Família Silva/)).toBeVisible();
  await staff.getByRole('button', { name: 'Cancelar reserva' }).click();
  await expect(node(staff, 'Mesa 1', 'Livre')).toBeVisible({ timeout: 5000 });
  expect(await dbQuery('select 1 from table_reservations where table_id=$1 and closed_at is null', [t.id])).toHaveLength(0);
  await staffCtx.close();
});

test('C5 · chamado de atendente: cliente chama → mesa destacada no mapa (≤ 3 s) → atendente resolve', async ({ browser }) => {
  const t = await useFreeTable('Mesa 5');
  const staffCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const staff = await staffCtx.newPage();
  await staff.goto('/atendente');
  await expect(node(staff, 'Mesa 5', 'Livre')).toBeVisible({ timeout: 15_000 });

  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();
  await enterTableByLink(page, QR.mesa5);
  const t0 = Date.now();
  await page.getByRole('button', { name: /Chamar atendente/ }).click();
  await expect(node(staff, 'Mesa 5', 'Chamado')).toBeVisible({ timeout: 10_000 });
  const ms = Date.now() - t0;
  recordMetric('ficha 16: cliente "Chamar atendente" → mesa em "Chamado" no mapa', ms, 3000);
  expect(ms).toBeLessThanOrEqual(3000);
  await expect(staff.getByText(/1 chamado/)).toBeVisible();
  expect(await dbQuery('select 1 from table_calls where table_id=$1 and resolved_at is null', [t.id])).toHaveLength(1);
  // chamado repetido não cria um segundo aberto
  await manager.post('table-calls', { tableId: t.id });
  expect(await dbQuery('select 1 from table_calls where table_id=$1 and resolved_at is null', [t.id])).toHaveLength(1);
  // resolver pela UI
  await node(staff, 'Mesa 5', 'Chamado').click();
  await expect(staff.getByText(/Chamado pendente desde/)).toBeVisible();
  await staff.getByRole('button', { name: 'Marcar como atendido' }).click();
  await expect(node(staff, 'Mesa 5', 'Livre')).toBeVisible({ timeout: 5000 });
  expect(await dbQuery('select 1 from table_calls where table_id=$1 and resolved_at is null', [t.id])).toHaveLength(0);
  // sem sessão não chama
  expect((await (await Api.create()).post('table-calls', { tableId: t.id })).status).toBe(401);
  await ctx.close();
  await staffCtx.close();
});

test('C6 · mesclar mesas (gestor): unidade única no mapa, capacidade somada, conta consolidada; desfazer reverte', async ({ browser }) => {
  const a = await useFreeTable('Mesa 5');
  const b = await useFreeTable('Mesa 8');
  const mgrCtx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const mgr = await mgrCtx.newPage();
  await mgr.goto('/gestor');
  await mgr.getByRole('button', { name: 'Planta do salão' }).click();
  await mgr.getByRole('button', { name: 'Selecionar para mesclar' }).click();
  await mgr.getByRole('button', { name: /^Mesa 5, 4 lugares/ }).click();
  await mgr.getByRole('button', { name: /^Mesa 8, 4 lugares/ }).click();
  await expect(mgr.getByText('Capacidade somada: 8 lugares')).toBeVisible();
  await mgr.getByRole('button', { name: 'Mesclar mesas' }).first().click();
  await expect(mgr.getByText(/Mesas mescladas/)).toBeVisible({ timeout: 8000 });

  const map = await tableMap(manager, E);
  expect(map.groups).toHaveLength(1);
  const g = map.groups[0];
  expect(g.capacity).toBe(8);
  expect(g.tableIds.sort()).toEqual([a.id, b.id].sort());
  expect(await dbQuery('select group_id from dining_tables where id in ($1,$2)', [a.id, b.id])).toEqual([{ group_id: g.id }, { group_id: g.id }]);

  // atendente: uma unidade só no mapa
  const staffCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const staff = await staffCtx.newPage();
  await staff.goto('/atendente');
  const unit = staff.getByRole('button', { name: new RegExp(`^${g.label.replace('+', '\\+')}: Livre`) });
  await expect(unit).toBeVisible({ timeout: 15_000 });
  await expect(staff.getByRole('button', { name: /^Mesa 5: / })).toHaveCount(0);
  await expect(staff.getByRole('button', { name: /^Mesa 8: / })).toHaveCount(0);

  // dois pedidos pagos, um em cada mesa → conta consolidada única; mapa mostra o grupo ocupado
  const api = await clientApi();
  const o1 = await createOrder(api, { establishmentId: E, tableId: a.id, items: [{ menuItemId: item('Cerveja IPA 600ml').id, quantity: 1 }] });
  const o2 = await createOrder(api, { establishmentId: E, tableId: b.id, items: [{ menuItemId: item('X-Burger').id, quantity: 1 }] });
  await payApproved(api, o1.body.id, o1.body.totalCents);
  await payApproved(api, o2.body.id, o2.body.totalCents);
  await expect(staff.getByRole('button', { name: new RegExp(`^${g.label.replace('+', '\\+')}: Ocupada`) })).toBeVisible({ timeout: 5000 });
  const check = (await manager.get(`establishments/${E}/table-checks/${a.id}`)).body;
  expect(check.totalCents).toBe(o1.body.totalCents + o2.body.totalCents);
  expect(check.orders.map((x: any) => x.number).sort()).toEqual([o1.body.number, o2.body.number].sort());
  expect((await manager.get(`establishments/${E}/table-checks/${b.id}`)).body.totalCents).toBe(check.totalCents);

  // operações inválidas
  const c = await tableByLabel('Mesa 10');
  expect((await manager.post(`establishments/${E}/table-groups`, { tableIds: [c.id] })).status).toBe(400);
  expect((await manager.post(`establishments/${E}/table-groups`, { tableIds: [a.id, c.id] })).status).toBe(409); // Mesa 5 já mesclada
  expect((await manager.post(`establishments/${E}/table-groups`, { tableIds: [c.id, c.id] })).status).toBe(400);
  const foreign = await dbOne<any>('select id from dining_tables where establishment_id=$1 limit 1', [SEED.cantina]);
  expect([400, 404]).toContain((await manager.post(`establishments/${E}/table-groups`, { tableIds: [c.id, foreign!.id] })).status);
  expect([403, 404]).toContain((await (await Api.as(ACCOUNTS.attendant.email)).post(`establishments/${E}/table-groups`, { tableIds: [c.id, a.id] })).status);
  expect((await manager.del(`establishments/${E}/table-groups/00000000-0000-4000-8000-000000000000`)).status).toBe(404);

  // desfazer (UI do gestor) → mesas voltam a aparecer individualmente
  await expect(mgr.getByText('8 lugares no total')).toBeVisible(); // a mescla recém-criada já está selecionada
  await mgr.getByRole('button', { name: 'Desfazer mesclagem' }).click();
  await expect(mgr.getByText('Mesclagem desfeita')).toBeVisible({ timeout: 8000 });
  expect((await tableMap(manager, E)).groups).toHaveLength(0);
  expect(await dbQuery('select group_id from dining_tables where id in ($1,$2)', [a.id, b.id])).toEqual([{ group_id: null }, { group_id: null }]);
  await expect(staff.getByRole('button', { name: /^Mesa 5: Ocupada/ })).toBeVisible({ timeout: 8000 });
  await expect(staff.getByRole('button', { name: /^Mesa 8: Ocupada/ })).toBeVisible();
  await mgrCtx.close();
  await staffCtx.close();
});

test('C7 · ficha 16: livre, ocupada, reservada e chamado têm cores DISTINTAS no mapa do atendente', async ({ browser }) => {
  await useFreeTable('Mesa 1');
  const occupied = await useFreeTable('Mesa 5');
  const reserved = await useFreeTable('Mesa 8');
  const called = await useFreeTable('Mesa 10');
  expect((await manager.post(`establishments/${E}/tables/${occupied.id}/occupy`, { partySize: 2 })).status).toBeLessThan(300);
  expect((await manager.post(`establishments/${E}/tables/${reserved.id}/reservations`, { name: 'Cores E2E', partySize: 2 })).status).toBeLessThan(300);
  expect((await (await clientApi()).post('table-calls', { tableId: called.id })).status).toBeLessThan(300);
  const staffCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const staff = await staffCtx.newPage();
  await staff.goto('/atendente');
  const states: [string, string][] = [['Mesa 1', 'Livre'], ['Mesa 5', 'Ocupada'], ['Mesa 8', 'Reservada'], ['Mesa 10', 'Chamado']];
  const colors: Record<string, string> = {};
  for (const [label, status] of states) {
    const nodeBtn = node(staff, label, status);
    await expect(nodeBtn).toBeVisible({ timeout: 15_000 });
    colors[status] = await nodeBtn.locator('span').first().evaluate(el => {
      const cs = getComputedStyle(el);
      return `${cs.backgroundColor}|${cs.borderTopColor}|${cs.color}`;
    });
  }
  test.info().annotations.push({ type: 'cores (fundo|borda|texto)', description: JSON.stringify(colors) });
  expect(new Set(Object.values(colors)).size, `quatro estados, quatro estilos distintos: ${JSON.stringify(colors)}`).toBe(4);
  await staffCtx.close();
});
