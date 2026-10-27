import { expect, test } from '@playwright/test';
import { Api, createOrder } from '../support/api';
import { ACCOUNTS } from '../support/env';
import { dbOne, dbQuery } from '../support/db';
import { clientApi, managerApi, releaseTable, uniq } from '../support/domain';
import { elapsedUntil } from '../support/metrics';
import { brlRe, newStaffContext } from '../support/ui';
import { itemByName, openAttendant, orderCard, paidOrderAt, QR, SEED, staffBase, tableIdFor } from '../support/sprint3';

// Sprint 3 · grupo A (operação) e B (comandas/chamados): fichas 23, 24, 63, 10 (equipe), 18, 17 e 22.
// Dados isolados: pedidos/estações criados aqui; mesas liberadas e estações removidas no fim.

let manager: Api;
let customer: Api;
const base = staffBase();
const tables = new Set<string>();
const stationIds: string[] = [];
const itemsToReset: string[] = [];

test.beforeAll(async () => {
  manager = await managerApi();
  customer = await clientApi();
});
test.afterAll(async () => {
  for (const itemId of itemsToReset) await manager.patch(`${base}/menu/items/${itemId}`, { stationId: null });
  for (const id of stationIds) await manager.del(`${base}/kitchen-stations/${id}`);
  for (const t of tables) await releaseTable(manager, SEED.mestre, t);
});

const track = async (code: string) => {
  const id = await tableIdFor(manager, code);
  tables.add(id);
  return id;
};

/** Estado inicial determinístico: fecha (cobrando o saldo simulado) qualquer comanda aberta da mesa. */
async function closeOpenTabs(tableId: string) {
  const open = (await manager.get(`${base}/tabs`, { status: 'open' })).body as { id: string; tableIds: string[] }[];
  for (const tab of open.filter(t => t.tableIds.includes(tableId))) {
    await manager.post(`${base}/tabs/${tab.id}/close`, { idempotencyKey: `e2e-clean-${uniq()}`, method: 'credit', cardToken: 'sim_approved', paymentMethodId: 'simulated' });
  }
}

test('23 · fila de pedidos: FIFO, idade, filtro por status, tempo real e atrasados', async ({ browser }) => {
  test.setTimeout(300_000);
  await track(QR.mesa5);
  const staffCtx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const staff = await staffCtx.newPage();

  const first = await paidOrderAt(customer, manager, QR.mesa5, [{ name: 'Batata Frita', quantity: 1 }]);
  const second = await paidOrderAt(customer, manager, QR.mesa5, [{ name: 'Gin Tônica', quantity: 1 }]);
  // Pedido "atrasado": estimativa mínima (1 min) e espera > 1 min enquanto o restante do teste roda.
  const late = await paidOrderAt(customer, manager, QR.mesa5, [{ name: 'Heineken Long Neck', quantity: 1 }]);
  expect((await manager.patch(`${base}/orders/${late.id}/estimate`, { minutes: 1 })).status).toBe(200);

  await openAttendant(staff, 'Pedidos');
  // FIFO: o primeiro pago aparece antes do segundo (posição na fila crescente).
  await expect(orderCard(staff, first.number)).toBeVisible();
  await expect(orderCard(staff, second.number)).toBeVisible();
  const order = async () => (await staff.locator('article').evaluateAll(els => els.map(e => e.textContent ?? '')));
  const texts = await order();
  const idx = (n: number) => texts.findIndex(t => new RegExp(`^#${n}(?!\\d)`).test(t));
  expect(idx(first.number)).toBeGreaterThanOrEqual(0);
  expect(idx(first.number)).toBeLessThan(idx(second.number));
  await expect(orderCard(staff, first.number)).toContainText('Pago · novo');
  await expect(orderCard(staff, first.number)).toContainText(/\d+ min/); // idade em minutos

  // Filtro por status: iniciar preparo do primeiro → "Em preparo" mostra só ele; "Novos" não mostra mais.
  await orderCard(staff, first.number).getByRole('button', { name: 'Iniciar preparo' }).click();
  await expect(orderCard(staff, first.number)).toContainText('Em preparo');
  await staff.getByRole('button', { name: /^Em preparo \(/ }).click();
  await expect(orderCard(staff, first.number)).toBeVisible();
  await expect(orderCard(staff, second.number)).toHaveCount(0);
  await staff.getByRole('button', { name: /^Novos \(/ }).click();
  await expect(orderCard(staff, second.number)).toBeVisible();
  await expect(orderCard(staff, first.number)).toHaveCount(0);
  await staff.getByRole('button', { name: /^Todos \(/ }).click();

  // Tempo real: pedido novo aparece em ≤ 5 s sem recarregar.
  let navigations = 0;
  staff.on('framenavigated', f => f === staff.mainFrame() && navigations++);
  const before = navigations;
  const t0 = Date.now();
  const fresh = await paidOrderAt(customer, manager, QR.mesa5, [{ name: 'Gin Tônica', quantity: 1 }]);
  const ms = await elapsedUntil(t0, async () => (await orderCard(staff, fresh.number).count()) > 0, 12_000, 100);
  expect(ms).toBeLessThanOrEqual(5000);
  expect(navigations).toBe(before);

  // Atrasados: com estimativa de 1 min, o pedido vira "Atrasado" quando a idade passa de 1 min.
  await expect(orderCard(staff, late.number)).toContainText('Atrasado', { timeout: 150_000 });
  await expect(staff.getByTestId('late-count')).toContainText(/Atrasados: [1-9]/);
  const queue = await manager.get(`${base}/orders/queue`);
  expect(queue.status).toBe(200);
  expect(queue.body.lateCount).toBeGreaterThanOrEqual(1);
  const apiLate = queue.body.items.find((o: any) => o.id === late.id);
  expect(apiLate.late).toBe(true);
  expect(apiLate.ageMinutes).toBeGreaterThan(1);
  await staffCtx.close();
});

test('24 · cozinha por estação: filtro, item pronto por estação e pedido só fica pronto com todas', async ({ browser }) => {
  await track(QR.mesa8);
  const name = `Chapa ${uniq()}`;
  const created = await manager.post(`${base}/kitchen-stations`, { name });
  expect(created.status).toBeLessThan(300);
  stationIds.push(created.body.id);
  const burger = await itemByName(manager, 'X-Burger');
  itemsToReset.push(burger.id);
  expect((await manager.patch(`${base}/menu/items/${burger.id}`, { stationId: created.body.id })).status).toBe(200);

  const o = await paidOrderAt(customer, manager, QR.mesa8, [{ name: 'X-Burger', quantity: 1 }, { name: 'Batata Frita', quantity: 1 }]);
  const staffCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const staff = await staffCtx.newPage();
  await openAttendant(staff, 'Pedidos');
  const card = orderCard(staff, o.number);
  await expect(card).toContainText(name); // item rotulado com a estação
  await expect(card).toContainText('Geral');

  // Filtro por estação
  await staff.getByLabel('Filtrar por estação').selectOption({ label: name });
  await expect(card).toBeVisible();
  await staff.getByLabel('Filtrar por estação').selectOption({ label: 'Geral' });
  await expect(card).toBeVisible(); // o pedido também tem item sem estação
  await staff.getByLabel('Filtrar por estação').selectOption({ label: 'Todas as estações' });

  await card.getByRole('button', { name: 'Iniciar preparo' }).click();
  await expect(card).toContainText('Em preparo');
  // "Marcar como pronto" só quando nenhuma estação nomeada está pendente (API recusa também)
  await expect(card.getByRole('button', { name: 'Marcar como pronto' })).toHaveCount(0);
  const blocked = await manager.patch(`${base}/orders/${o.id}/status`, { status: 'ready' });
  expect(blocked.status).toBe(409);
  expect(blocked.body.code).toBe('STATIONS_PENDING');

  await card.getByRole('button', { name: `${name} pronta` }).click();
  await expect(card.getByRole('button', { name: `${name} pronta` })).toHaveCount(0);
  await expect(card).toContainText('Em preparo'); // falta a estação "Geral"
  expect((await dbOne<any>('select status from orders where id=$1', [o.id]))!.status).toBe('preparing');
  await card.getByRole('button', { name: 'Geral pronta' }).click();
  await expect(card).toContainText('Pronto', { timeout: 10_000 });
  expect((await dbOne<any>('select status from orders where id=$1', [o.id]))!.status).toBe('ready');
  await staffCtx.close();
});

test('63 · ajuste de tempo: só quem tem permissão; faixa 1–240; cliente vê o valor ajustado', async ({ browser }) => {
  await track(QR.mesa10);
  const o = await paidOrderAt(customer, manager, QR.mesa10, [{ name: 'Gin Tônica', quantity: 1 }]);

  // Atendente (sem orders.estimate) não vê o campo; API recusa.
  const attCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const att = await attCtx.newPage();
  await openAttendant(att, 'Pedidos');
  await expect(orderCard(att, o.number)).toBeVisible();
  await expect(att.getByLabel(`Tempo estimado do pedido ${o.number} (min)`)).toHaveCount(0);
  const attendant = await Api.as(ACCOUNTS.attendant.email);
  expect((await attendant.patch(`${base}/orders/${o.id}/estimate`, { minutes: 30 })).status).toBeClientError();
  await attCtx.close();

  // Gestor ajusta pela UI do tablet
  const mgrCtx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const mgr = await mgrCtx.newPage();
  await openAttendant(mgr, 'Pedidos');
  const field = mgr.getByLabel(`Tempo estimado do pedido ${o.number} (min)`);
  await field.fill('0');
  await expect(orderCard(mgr, o.number).getByRole('button', { name: 'Ajustar' })).toBeDisabled();
  await field.fill('241');
  await expect(orderCard(mgr, o.number).getByRole('button', { name: 'Ajustar' })).toBeDisabled();
  expect((await manager.patch(`${base}/orders/${o.id}/estimate`, { minutes: 0 })).status).toBeClientError();
  expect((await manager.patch(`${base}/orders/${o.id}/estimate`, { minutes: 241 })).status).toBeClientError();
  await field.fill('45');
  await orderCard(mgr, o.number).getByRole('button', { name: 'Ajustar' }).click();
  await expect(orderCard(mgr, o.number)).toContainText('Estimativa: 45 min (ajustada)');
  await mgrCtx.close();

  // Cliente vê o valor ajustado (API e tela)
  const mine = await customer.get(`orders/${o.id}`);
  expect(mine.body.estimatedMinutes).toBe(45);
  expect(mine.body.estimateAdjusted).toBe(true);
});

test('10 · cancelar pedido (equipe): atendente não cancela pago; gestor cancela e estorna automaticamente', async ({ browser }) => {
  await track(QR.mesa1);
  const o = await paidOrderAt(customer, manager, QR.mesa1, [{ name: 'Gin Tônica', quantity: 1 }]);
  const attendant = await Api.as(ACCOUNTS.attendant.email);
  expect((await attendant.post(`${base}/orders/${o.id}/cancel`)).status).toBeClientError();
  expect((await dbOne<any>('select status from orders where id=$1', [o.id]))!.status).toBe('paid');

  const attCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const att = await attCtx.newPage();
  await openAttendant(att, 'Pedidos');
  await expect(orderCard(att, o.number)).toBeVisible();
  await expect(att.getByRole('button', { name: `Cancelar pedido ${o.number}` })).toHaveCount(0);
  await attCtx.close();

  const mgrCtx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const mgr = await mgrCtx.newPage();
  await openAttendant(mgr, 'Pedidos');
  await mgr.getByRole('button', { name: `Cancelar pedido ${o.number}` }).click();
  await expect(orderCard(mgr, o.number)).toHaveCount(0, { timeout: 10_000 });
  const row = await dbOne<any>('select status from orders where id=$1', [o.id]);
  expect(row!.status).toBe('cancelled');
  const pay = await dbQuery<any>('select status from payments where order_id=$1', [o.id]);
  expect(pay.map(p => p.status)).toEqual(['refunded']);
  await mgrCtx.close();
});

test('18 · chamado de garçom: cliente chama → equipe vê em tempo real → resolve → cliente é avisado', async ({ browser }) => {
  const tableId = await track(QR.mesa5);
  const staffCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const staff = await staffCtx.newPage();
  await openAttendant(staff, 'Chamados');
  await expect(staff.getByText('Nenhum chamado aberto').or(staff.getByTestId('table-call').first())).toBeVisible();
  const before = await customer.get('table-calls/mine', { tableId });
  if (before.body?.call) await manager.post(`${base}/tables/${tableId}/calls/resolve`);

  const t0 = Date.now();
  const call = await customer.post('table-calls', { tableId });
  expect(call.status).toBeLessThan(300);
  const call2 = await customer.post('table-calls', { tableId });
  expect(call2.status, 'chamado duplicado é recusado ou devolve o mesmo (nunca cria um segundo aberto)').toBeLessThan(500);
  const ms = await elapsedUntil(t0, async () => (await staff.getByTestId('table-call').count()) > 0, 12_000, 100);
  expect(ms).toBeLessThanOrEqual(5000);
  await expect(staff.getByTestId('calls-badge')).toBeVisible();
  const open = await dbQuery<any>('select id from table_calls where table_id=$1 and resolved_at is null', [tableId]);
  expect(open.length).toBe(1);
  expect((await customer.get('table-calls/mine', { tableId })).body.call.id).toBe(call.body.id);

  await staff.getByRole('button', { name: /Atender chamado da/ }).first().click();
  await expect(staff.getByText(/Nenhum chamado aberto/)).toBeVisible({ timeout: 10_000 });
  expect((await dbQuery<any>('select id from table_calls where table_id=$1 and resolved_at is null', [tableId])).length).toBe(0);
  expect((await customer.get('table-calls/mine', { tableId })).body.call).toBeNull();
  // Cliente não resolve; anônimo não lista
  expect((await customer.post(`${base}/table-calls/${call.body.id}/resolve`)).status).toBeClientError();
  expect((await (await Api.create()).get(`${base}/table-calls`)).status).toBe(401);
  await staffCtx.close();
});

test('17/22 · comanda: pedido pago individualmente + pedido na comanda; fechar cobra só o saldo, uma vez', async ({ browser }) => {
  const tableId = await track(QR.mesa8);
  await closeOpenTabs(tableId);
  const paid = await paidOrderAt(customer, manager, QR.mesa8, [{ name: 'Gin Tônica', quantity: 1 }]); // pago adiantado
  const unpaidItem = await itemByName(manager, 'Batata Frita');
  const unpaid = await createOrder(customer, { establishmentId: SEED.mestre, tableId, items: [{ menuItemId: unpaidItem.id, quantity: 2 }] });
  expect(unpaid.status).toBeLessThan(300); // não pago: vai para a comanda
  const staffCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const staff = await staffCtx.newPage();
  await openAttendant(staff, 'Comandas');
  await staff.getByLabel('Mesa da nova comanda').selectOption({ label: 'Mesa 8' });
  await staff.getByRole('button', { name: 'Abrir comanda' }).click();
  const tabCard = staff.getByTestId('tab-card').filter({ hasText: 'Mesa 8' });
  await expect(tabCard).toBeVisible();

  await tabCard.getByLabel('Pedido a atribuir à comanda').selectOption({ value: unpaid.body.id });
  await tabCard.getByRole('button', { name: 'Atribuir' }).click();
  await expect(tabCard.locator('li', { hasText: `#${unpaid.body.number} ·` })).toBeVisible();
  await expect(tabCard).toContainText('Na comanda'); // nunca "Pago"
  await tabCard.getByLabel('Pedido a atribuir à comanda').selectOption({ value: paid.id });
  await tabCard.getByRole('button', { name: 'Atribuir' }).click();
  await expect(tabCard.locator('li', { hasText: `#${paid.number} ·` })).toContainText('Pago');
  await expect(tabCard.getByTestId('tab-paid')).toContainText(brlRe(paid.totalCents));

  const tab = (await manager.get(`${base}/tabs`, { status: 'open' })).body.find((t: any) => t.orders.some((x: any) => x.id === unpaid.body.id));
  expect(tab.totalCents).toBe(paid.totalCents + unpaid.body.totalCents);
  expect(tab.paidCents).toBe(paid.totalCents);
  expect(tab.balanceCents).toBe(unpaid.body.totalCents);
  await expect(tabCard.getByTestId('tab-balance')).toContainText(brlRe(unpaid.body.totalCents));

  // Recusa não fecha nem cobra
  await tabCard.getByLabel('Cartão simulado').selectOption('sim_refused');
  await tabCard.getByRole('button', { name: /Fechar e pagar/ }).click();
  await expect(staff.getByText(/O pagamento foi recusado/)).toBeVisible({ timeout: 10_000 });
  expect((await dbOne<any>("select count(*)::int as n from tab_payments where tab_id=$1 and status='approved'", [tab.id]))!.n).toBe(0);
  await expect(tabCard).toBeVisible();

  // Aprovado: cobra só o saldo; o pedido já pago não é cobrado de novo
  await tabCard.getByLabel('Cartão simulado').selectOption('sim_approved');
  await tabCard.getByRole('button', { name: /Fechar e pagar/ }).click();
  await expect(staff.getByText(/Comanda fechada/)).toBeVisible({ timeout: 10_000 });
  await expect(staff.getByTestId('tab-card').filter({ hasText: 'Mesa 8' })).toHaveCount(0);
  expect((await dbOne<any>("select count(*)::int as n from payments where order_id=$1 and status='approved'", [paid.id]))!.n).toBe(1);
  const charged = await dbQuery<any>("select amount_cents from tab_payments where tab_id=$1 and status='approved'", [tab.id]);
  expect(charged.map(c => c.amount_cents)).toEqual([unpaid.body.totalCents]); // só o saldo
  const closed = (await manager.get(`${base}/tabs`, { status: 'closed' })).body.find((t: any) => t.id === tab.id);
  expect(closed.status).toBe('closed');
  await staffCtx.close();
});

test('22 · fechar comanda é idempotente e não cobra duas vezes; comanda fechada recusa novo fechamento', async () => {
  const tableId = await track(QR.mesa10);
  await closeOpenTabs(tableId);
  const item = await itemByName(manager, 'Gin Tônica');
  const o = await createOrder(customer, { establishmentId: SEED.mestre, tableId, items: [{ menuItemId: item.id, quantity: 1 }] });
  const tab = (await manager.post(`${base}/tables/${tableId}/tab`)).body;
  expect((await manager.post(`${base}/tables/${tableId}/tab`)).body.id, 'abrir de novo devolve a comanda aberta').toBe(tab.id);
  expect((await manager.post(`${base}/tabs/${tab.id}/orders`, { orderId: o.body.id })).status).toBeLessThan(300);

  const key = `e2e-close-${uniq()}`;
  const body = { idempotencyKey: key, method: 'credit', cardToken: 'sim_approved', paymentMethodId: 'simulated' };
  const [a, b] = await Promise.all([manager.post(`${base}/tabs/${tab.id}/close`, body), manager.post(`${base}/tabs/${tab.id}/close`, body)]);
  expect([a.status, b.status].filter(s => s < 300).length).toBeGreaterThanOrEqual(1);
  expect((await dbOne<any>("select count(*)::int as n from tab_payments where tab_id=$1 and status='approved'", [tab.id]))!.n).toBe(1);
  const again = await manager.post(`${base}/tabs/${tab.id}/close`, body);
  expect(again.status).toBeLessThan(300);
  expect(again.body.replayed).toBe(true);
  const other = await manager.post(`${base}/tabs/${tab.id}/close`, { ...body, idempotencyKey: `e2e-close-${uniq()}` });
  expect(other.status).toBe(409);
  expect(other.body.code).toBe('TAB_CLOSED');
  expect((await dbOne<any>("select count(*)::int as n from tab_payments where tab_id=$1 and status='approved'", [tab.id]))!.n).toBe(1);
  // Atendente também gerencia comandas (tabs.manage); cliente não.
  expect((await customer.get(`${base}/tabs`, { status: 'open' })).status).toBeClientError();
});

test('17 · pedido de comanda vai para o preparo pelo tablet; quitado na comanda não aparece como "aguardando pagamento"', async ({ browser }) => {
  const tableId = await track(QR.mesa10);
  await closeOpenTabs(tableId);
  const item = await itemByName(manager, 'Gin Tônica');
  const closeBody = () => ({ idempotencyKey: `e2e-close-${uniq()}`, method: 'credit', cardToken: 'sim_approved', paymentMethodId: 'simulated' });
  const staffCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const staff = await staffCtx.newPage();

  // Pedido atribuído à comanda (não pago): o card diz "Na comanda" e o atendente inicia o preparo sem cobrança.
  const a = await createOrder(customer, { establishmentId: SEED.mestre, tableId, items: [{ menuItemId: item.id, quantity: 1 }] });
  const tabA = (await manager.post(`${base}/tables/${tableId}/tab`)).body;
  expect((await manager.post(`${base}/tabs/${tabA.id}/orders`, { orderId: a.body.id })).status).toBeLessThan(300);
  await openAttendant(staff, 'Pedidos');
  const cardA = orderCard(staff, a.body.number);
  await expect(cardA).toContainText('Na comanda');
  await expect(cardA).not.toContainText('Aguardando pagamento');
  await cardA.getByRole('button', { name: 'Iniciar preparo' }).click();
  await expect(cardA).toContainText('Em preparo');
  expect((await dbOne<any>('select status from orders where id=$1', [a.body.id]))!.status).toBe('preparing');
  expect((await dbOne<any>('select count(*)::int as n from payments where order_id=$1', [a.body.id]))!.n).toBe(0);
  expect((await manager.post(`${base}/tabs/${tabA.id}/close`, closeBody())).status).toBeLessThan(300);

  // Pedido já quitado na comanda e ainda não iniciado: "Pago na comanda", sem "Aguardando pagamento", sem cancelar, com iniciar.
  const b = await createOrder(customer, { establishmentId: SEED.mestre, tableId, items: [{ menuItemId: item.id, quantity: 1 }] });
  const tabB = (await manager.post(`${base}/tables/${tableId}/tab`)).body;
  expect((await manager.post(`${base}/tabs/${tabB.id}/orders`, { orderId: b.body.id })).status).toBeLessThan(300);
  expect((await manager.post(`${base}/tabs/${tabB.id}/close`, closeBody())).status).toBeLessThan(300);
  expect((await dbOne<any>('select status from orders where id=$1', [b.body.id]))!.status).toBe('received');
  await openAttendant(staff, 'Pedidos');
  const cardB = orderCard(staff, b.body.number);
  await expect(cardB).toContainText('Pago na comanda');
  await expect(cardB).not.toContainText('Aguardando pagamento');
  await expect(staff.getByRole('button', { name: `Cancelar pedido ${b.body.number}` })).toHaveCount(0);
  await cardB.getByRole('button', { name: 'Iniciar preparo' }).click();
  await expect(cardB).toContainText('Em preparo');
  expect((await dbOne<any>('select status from orders where id=$1', [b.body.id]))!.status).toBe('preparing');

  // Sem comanda, pedido não pago continua fora da fila e da cozinha (a API recusa iniciar).
  const loose = await createOrder(customer, { establishmentId: SEED.mestre, tableId, items: [{ menuItemId: item.id, quantity: 1 }] });
  await openAttendant(staff, 'Pedidos');
  await expect(orderCard(staff, loose.body.number)).toHaveCount(0);
  expect((await manager.patch(`${base}/orders/${loose.body.id}/status`, { status: 'preparing' })).status).toBe(422);
  expect((await customer.post(`orders/${loose.body.id}/cancel`)).status).toBeLessThan(300);
  await staffCtx.close();
});
