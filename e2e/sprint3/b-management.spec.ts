import { expect, test } from '@playwright/test';
import { API_URL, CLIENT_HEADER, ACCOUNTS } from '../support/env';
import { request } from '@playwright/test';
import { Api } from '../support/api';
import { dbOne } from '../support/db';
import { clientApi, managerApi, releaseTable, uniq } from '../support/domain';
import { brlRe, newStaffContext } from '../support/ui';
import { closeShiftIfOpen, itemByName, openManagerSection, paidOrderAt, QR, SEED, staffBase, tableIdFor } from '../support/sprint3';

// Sprint 3 · grupo A/D (gestão): fichas 24 (estações), 26 (impressoras), 25 (turno), 27 (dashboard) e 50 (estoque).

let manager: Api;
let customer: Api;
const base = staffBase();
const cleanup: (() => Promise<unknown>)[] = [];

test.beforeAll(async () => {
  manager = await managerApi();
  customer = await clientApi();
});
test.afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => null);
});

test('24 · estações (gestor): criar, renomear, atribuir ao item e excluir (itens voltam para Geral); atendente não gerencia', async ({ browser }) => {
  const name = `Bar ${uniq()}`;
  const renamed = `${name} 2`;
  const ctx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const page = await ctx.newPage();
  await openManagerSection(page, 'Cozinha');
  await page.getByLabel('Nome da estação').fill(name);
  await page.getByRole('button', { name: 'Adicionar' }).click();
  const row = page.getByTestId('station-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `Renomear estação ${name}` }).click();
  await page.getByLabel(`Novo nome da estação ${name}`).fill(renamed);
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByTestId('station-row').filter({ hasText: renamed })).toBeVisible();
  const station = (await manager.get(`${base}/kitchen-stations`)).body.find((s: any) => s.name === renamed);
  expect(station).toBeTruthy();
  cleanup.push(() => manager.del(`${base}/kitchen-stations/${station.id}`));

  // Duplicado e vazio são recusados; atendente não cria estação, mas lê a lista.
  expect((await manager.post(`${base}/kitchen-stations`, { name: renamed })).status).toBeClientError();
  expect((await manager.post(`${base}/kitchen-stations`, { name: '   ' })).status).toBeClientError();
  const attendant = await Api.as(ACCOUNTS.attendant.email);
  expect((await attendant.post(`${base}/kitchen-stations`, { name: `x-${uniq()}` })).status).toBeClientError();
  expect((await attendant.get(`${base}/kitchen-stations`)).status).toBe(200);
  // Estação de outro estabelecimento não vale para o item
  const burger = await itemByName(manager, 'Gin Tônica');
  const other = await Api.as(ACCOUNTS.managerStart.email);
  const foreign = await other.post(`establishments/${SEED.cantina}/kitchen-stations`, { name: `Fora ${uniq()}` });
  if (foreign.status < 300) {
    cleanup.push(() => other.del(`establishments/${SEED.cantina}/kitchen-stations/${foreign.body.id}`));
    const bad = await manager.patch(`${base}/menu/items/${burger.id}`, { stationId: foreign.body.id });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('INVALID_STATION');
  }

  // Atribui pela UI do cardápio; excluir a estação devolve o item para Geral
  await openManagerSection(page, 'Cardápio');
  await page.getByRole('button', { name: /Editar Gin Tônica/ }).click();
  await page.getByLabel('Estação da cozinha').selectOption({ label: renamed });
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect.poll(async () => (await manager.get(`${base}/menu/items`)).body.find((i: any) => i.name === 'Gin Tônica').stationName).toBe(renamed);
  cleanup.push(() => manager.patch(`${base}/menu/items/${burger.id}`, { stationId: null }));
  await openManagerSection(page, 'Cozinha');
  await page.getByRole('button', { name: `Excluir estação ${renamed}` }).click();
  await page.getByRole('button', { name: 'Excluir estação', exact: true }).click();
  await expect(page.getByTestId('station-row').filter({ hasText: renamed })).toHaveCount(0);
  expect((await manager.get(`${base}/menu/items`)).body.find((i: any) => i.name === 'Gin Tônica').stationId).toBeNull();
  await ctx.close();
});

test('26 · impressora offline: sinal do dispositivo, 60 s sem sinal → alerta in-app em tempo real, sinal volta → online', async ({ browser }) => {
  test.setTimeout(240_000);
  const name = `Impressora ${uniq()}`;
  const mgrCtx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const mgr = await mgrCtx.newPage();
  await openManagerSection(mgr, 'Cozinha');
  await mgr.getByLabel('Nome da impressora').fill(name);
  await mgr.getByRole('button', { name: 'Cadastrar' }).click();
  const key = await mgr.getByTestId('device-key').innerText();
  expect(key).toMatch(/^pk_/);
  const row = mgr.getByTestId('printer-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  const printer = (await manager.get(`${base}/printers`)).body.find((p: any) => p.name === name);
  cleanup.push(() => manager.del(`${base}/printers/${printer.id}`));
  expect(JSON.stringify((await manager.get(`${base}/printers`)).body)).not.toContain(key); // a chave não é listada

  // Heartbeat do dispositivo (sem sessão) com a chave; chave inválida = 401
  const device = await request.newContext({ extraHTTPHeaders: CLIENT_HEADER });
  expect((await device.post(`${API_URL}/printers/heartbeat`, { headers: { 'X-Printer-Key': 'pk_invalida' } })).status()).toBe(401);
  expect((await device.post(`${API_URL}/printers/heartbeat`, { headers: { 'X-Printer-Key': key } })).status()).toBe(204);
  await expect(row).toContainText('Online');

  // Atendente também vê o alerta (sem SMS/e-mail): abre o tablet e espera o monitor da API (≤ ~75 s)
  const attCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const att = await attCtx.newPage();
  await att.goto('/atendente');
  await expect(att.getByRole('alert').filter({ hasText: name })).toBeVisible({ timeout: 120_000 });
  await expect(mgr.getByRole('alert').filter({ hasText: name })).toBeVisible({ timeout: 10_000 });
  await expect(row).toContainText('Offline');
  const alerts = (await manager.get(`${base}/alerts`)).body.filter((a: any) => a.kind === 'printer_offline' && a.message.includes(name));
  expect(alerts.length, 'um único alerta aberto por impressora').toBe(1);

  // Volta o sinal → online e o alerta é resolvido
  expect((await device.post(`${API_URL}/printers/heartbeat`, { headers: { 'X-Printer-Key': key } })).status()).toBe(204);
  await expect(row).toContainText('Online', { timeout: 10_000 });
  await expect(att.getByRole('alert').filter({ hasText: name })).toHaveCount(0, { timeout: 10_000 });
  expect((await manager.get(`${base}/alerts`)).body.filter((a: any) => a.message.includes(name)).length).toBe(0);
  await device.dispose();
  await attCtx.close();
  await mgrCtx.close();
});

test('25 · turno: abrir, pedidos entregues/cancelados entram no histórico com totais; erros de estado', async ({ browser }) => {
  await closeShiftIfOpen(manager);
  const ctx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const page = await ctx.newPage();
  await openManagerSection(page, 'Turno');
  await expect(page.getByTestId('shift-state')).toContainText('Nenhum turno aberto');
  await page.getByRole('button', { name: 'Abrir turno' }).click();
  await expect(page.getByTestId('shift-state')).toContainText('Aberto desde');
  expect((await manager.post(`${base}/shift/open`)).body.code).toBe('SHIFT_ALREADY_OPEN');

  // Atendente não abre nem fecha turno
  const attendant = await Api.as(ACCOUNTS.attendant.email);
  expect((await attendant.post(`${base}/shift/close`)).status).toBeClientError();

  const tableId = await tableIdFor(manager, QR.mesa1);
  cleanup.push(() => releaseTable(manager, SEED.mestre, tableId));
  const delivered = await paidOrderAt(customer, manager, QR.mesa1, [{ name: 'Gin Tônica', quantity: 1 }]);
  const cancelled = await paidOrderAt(customer, manager, QR.mesa1, [{ name: 'Heineken Long Neck', quantity: 1 }]);
  for (const status of ['preparing', 'ready', 'delivered']) expect((await manager.patch(`${base}/orders/${delivered.id}/status`, { status })).status).toBe(200);
  expect((await manager.post(`${base}/orders/${cancelled.id}/cancel`)).status).toBeLessThan(300);

  await page.getByRole('button', { name: 'Fechar turno' }).first().click();
  await page.getByRole('button', { name: 'Fechar turno' }).last().click();
  await expect(page.getByTestId('shift-state')).toContainText('Nenhum turno aberto');
  await page.getByRole('button', { name: /Ver pedidos/ }).first().click();
  await expect(page.getByTestId('shift-delivered')).toHaveText('1');
  await expect(page.getByTestId('shift-cancelled')).toHaveText('1');
  await expect(page.getByText(`#${delivered.number}`)).toBeVisible();
  await expect(page.getByText(`#${cancelled.number}`)).toBeVisible();
  await expect(page.getByTestId('shift-delivered-cents')).toHaveText(brlRe(delivered.totalCents));
  await expect(page.getByTestId('shift-refunded-cents')).toHaveText(brlRe(cancelled.totalCents));
  expect((await manager.post(`${base}/shift/close`)).body.code).toBe('NO_OPEN_SHIFT');
  const shifts = (await manager.get(`${base}/shifts`)).body.items;
  const hist = (await manager.get(`${base}/shifts/${shifts[0].id}`)).body;
  expect(hist.totals.deliveredCount).toBe(1);
  expect(hist.totals.cancelledCount).toBe(1);
  await ctx.close();
});

test('27 · dashboard: números da tela batem com a API e mudam com um pedido real', async ({ browser }) => {
  const tableId = await tableIdFor(manager, QR.mesa5);
  cleanup.push(() => releaseTable(manager, SEED.mestre, tableId));
  const before = (await manager.get(`${base}/dashboard`)).body;
  const ctx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const page = await ctx.newPage();
  await openManagerSection(page, 'Dashboard');
  await expect(page.getByTestId('kpi-orders')).toHaveText(String(before.ordersCount));
  const o = await paidOrderAt(customer, manager, QR.mesa5, [{ name: 'Gin Tônica', quantity: 1 }]);
  await expect(page.getByTestId('kpi-orders')).toHaveText(String(before.ordersCount + 1), { timeout: 15_000 });
  const after = (await manager.get(`${base}/dashboard`)).body;
  expect(after.ordersCount).toBe(before.ordersCount + 1);
  expect(after.revenueCents).toBe(before.revenueCents + o.totalCents);
  expect(after.averageTicketCents).toBe(Math.floor(after.revenueCents / after.ordersCount));
  expect(after.totalTables).toBeGreaterThan(0);
  expect(after.occupiedTables).toBeGreaterThanOrEqual(0);
  // Atendente não tem dashboard.view
  expect(((await (await Api.as(ACCOUNTS.attendant.email)).get(`${base}/dashboard`)).status)).toBeClientError();
  await ctx.close();
});

test('50 · estoque mínimo: baixa uma vez ao iniciar preparo, cancelar antes não baixa, alerta in-app sem repetir', async ({ browser }) => {
  const tableId = await tableIdFor(manager, QR.mesa8);
  cleanup.push(() => releaseTable(manager, SEED.mestre, tableId));
  const gin = (await manager.get(`${base}/ingredients`)).body.find((i: any) => i.name === 'Gin');
  cleanup.push(() => manager.put(`${base}/ingredients/${gin.id}/stock`, { stockQuantity: null, minStockQuantity: 0 }));
  const ctx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const page = await ctx.newPage();
  await openManagerSection(page, 'Fichas técnicas');
  await page.getByRole('button', { name: /^Insumos/ }).click();
  await page.getByRole('button', { name: 'Estoque de Gin' }).click();
  await page.getByLabel(/Estoque atual/).fill('120');
  await page.getByLabel(/Estoque mínimo/).fill('100');
  await page.getByRole('button', { name: 'Salvar estoque' }).click();
  await expect(page.getByTestId('stock-Gin')).toContainText('120');
  await expect(page.getByTestId('stock-Gin')).not.toContainText('Estoque baixo');
  const stock = async () => Number((await manager.get(`${base}/ingredients`)).body.find((i: any) => i.name === 'Gin').stockQuantity);
  expect(await stock()).toBe(120);

  // Cancelar ANTES do preparo não baixa
  const cancelled = await paidOrderAt(customer, manager, QR.mesa8, [{ name: 'Gin Tônica', quantity: 1 }]);
  expect((await manager.post(`${base}/orders/${cancelled.id}/cancel`)).status).toBeLessThan(300);
  expect(await stock()).toBe(120);

  // Iniciar preparo baixa 50 ml (ficha: Gin Tônica) exatamente uma vez
  const o = await paidOrderAt(customer, manager, QR.mesa8, [{ name: 'Gin Tônica', quantity: 1 }]);
  expect((await manager.patch(`${base}/orders/${o.id}/status`, { status: 'preparing' })).status).toBe(200);
  expect(await stock()).toBe(70);
  expect((await manager.patch(`${base}/orders/${o.id}/status`, { status: 'preparing' })).status).toBeClientError(); // repetir não baixa de novo
  expect(await stock()).toBe(70);
  expect((await dbOne<any>('select count(*)::int as n from stock_movements where order_id=$1', [o.id]))!.n).toBeGreaterThanOrEqual(1);

  // Alerta in-app ao gestor (≤ mínimo), uma vez; atendente não vê
  await expect(page.getByRole('alert').filter({ hasText: 'Gin' })).toBeVisible({ timeout: 15_000 });
  const alerts = (await manager.get(`${base}/alerts`)).body.filter((a: any) => a.kind === 'low_stock' && a.message.includes('Gin'));
  expect(alerts.length).toBe(1);
  const attendant = await Api.as(ACCOUNTS.attendant.email);
  expect((await attendant.get(`${base}/alerts`)).body.filter((a: any) => a.kind === 'low_stock').length).toBe(0);
  // Cancelar depois do preparo não devolve estoque
  expect((await manager.post(`${base}/orders/${o.id}/cancel`)).status).toBeLessThan(300);
  expect(await stock()).toBe(70);
  // Repor tira o alerta
  await page.getByRole('button', { name: 'Estoque de Gin' }).click();
  await page.getByLabel(/Estoque atual/).fill('500');
  await page.getByRole('button', { name: 'Salvar estoque' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Gin' })).toHaveCount(0, { timeout: 10_000 });
  await ctx.close();
});
