import { expect, test } from '@playwright/test';
import { Api, createOrder, payApproved } from '../support/api';
import { ACCOUNTS } from '../support/env';
import { dbOne, dbQuery } from '../support/db';
import { addItem, openCart, payWithCard } from '../support/client-flow';
import { clientApi, createDisposableAccount, managerApi, releaseTable, verifyEmail } from '../support/domain';
import { elapsedUntil } from '../support/metrics';
import { brlRe, enterTableByLink, nav, newClientContext, newStaffContext, openClient } from '../support/ui';
import { itemByName, paidOrderAt, QR, SEED, staffBase, tableIdFor } from '../support/sprint3';

// Sprint 3 · grupo C (cliente): fichas 05, 51, 07, 14, 10 e 18 (lado do cliente).

let manager: Api;
let customer: Api;
const base = staffBase();
const tables = new Set<string>();

test.beforeAll(async () => {
  manager = await managerApi();
  customer = await clientApi();
});
test.afterAll(async () => {
  for (const t of tables) await releaseTable(manager, SEED.mestre, t);
});
const track = async (code: string) => {
  const id = await tableIdFor(manager, code);
  tables.add(id);
  return id;
};
const advance = async (orderId: string, ...statuses: string[]) => {
  for (const status of statuses) expect((await manager.patch(`${base}/orders/${orderId}/status`, { status })).status).toBe(200);
};

test('05 · pedido pronto: aviso in-app (toast + banner) em ≤ 5 s, sem duplicar e sem reportar falha como sucesso', async ({ browser }) => {
  await track(QR.mesa5);
  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();
  await enterTableByLink(page, QR.mesa5);
  await expect(page.getByRole('button', { name: 'Chamar atendente' })).toBeVisible();
  const o = await paidOrderAt(customer, manager, QR.mesa5, [{ name: 'Gin Tônica', quantity: 1 }]);
  await advance(o.id, 'preparing');
  await expect(page.getByTestId('order-ready-banner')).toHaveCount(0);
  const t0 = Date.now();
  await advance(o.id, 'ready');
  const ms = await elapsedUntil(t0, async () => (await page.getByTestId('order-ready-banner').count()) > 0, 12_000, 50);
  expect(ms).toBeLessThanOrEqual(5000);
  await expect(page.getByText('Seu pedido está pronto!').first()).toBeVisible(); // toast e/ou banner
  await expect(page.getByTestId('order-ready-banner')).toHaveCount(1);

  // Dedupe: um registro por canal; falha do provedor aparece como "failed", nunca como "sent"
  const rows = await dbQuery<any>("select channel, status, error_code from order_notifications where order_id=$1 and kind='order_ready' order by channel", [o.id]);
  const channels = rows.map(r => r.channel);
  expect(new Set(channels).size, `um registro por canal (${JSON.stringify(rows)})`).toBe(channels.length);
  expect(rows.find(r => r.channel === 'in_app')?.status).toBe('sent');
  for (const r of rows.filter(r => r.status === 'failed')) expect(r.error_code).toBeTruthy();
  expect(rows.some(r => r.channel === 'sms'), 'SMS não é enviado por padrão').toBe(false);
  const staffView = (await manager.get(`${base}/orders`, { status: 'ready', pageSize: 100 })).body.items.find((x: any) => x.id === o.id);
  expect(staffView.notifications.map((n: any) => n.channel).sort()).toEqual(channels.sort());

  // Banner abre o acompanhamento do pedido pronto
  await page.getByTestId('order-ready-banner').getByRole('button', { name: 'Ver pedido' }).click();
  await expect(page.locator('p', { hasText: 'Seu pedido está pronto!' })).toBeVisible();
  await expect(page.getByTestId('order-ready-banner')).toHaveCount(0);
  await ctx.close();
});

test('51 · posição na fila ao vivo: bate com a API, avança em tempo real e também por polling sem Socket.IO', async ({ browser }) => {
  test.setTimeout(240_000);
  await track(QR.mesa8);
  const a = await paidOrderAt(customer, manager, QR.mesa8, [{ name: 'Batata Frita', quantity: 1 }]);
  const b = await paidOrderAt(customer, manager, QR.mesa8, [{ name: 'Gin Tônica', quantity: 1 }]);
  const posOf = async (id: string) => (await customer.get(`orders/${id}/queue-position`)).body;
  const pa = await posOf(a.id);
  const pb = await posOf(b.id);
  expect(pa.state).toBe('waiting');
  expect(pb.position).toBe(pa.position + 1); // FIFO por pagamento
  expect(pb.ordersAhead).toBe(pa.ordersAhead + 1);

  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();
  await openClient(page);
  await nav(page, 'Pedidos');
  await page.getByRole('button', { name: new RegExp(`Pedido #${b.number}`) }).click();
  await expect(page.getByTestId('queue-position-value')).toHaveText(`${pb.position}º`);
  await expect(page.getByTestId('queue-position')).toContainText(pb.ordersAhead === 1 ? '1 pedido à sua frente' : `${pb.ordersAhead} pedidos à sua frente`);

  // Tempo real: o pedido da frente começa o preparo → posição recalcula sem recarregar
  const t0 = Date.now();
  await advance(a.id, 'preparing', 'ready', 'delivered');
  const now = await posOf(b.id);
  expect(now.ordersAhead).toBeLessThan(pb.ordersAhead);
  const expected = now.position === null ? '—' : `${now.position}º`;
  const ms = await elapsedUntil(t0, async () => (await page.getByTestId('queue-position-value').innerText()) === expected, 12_000, 100);
  expect(ms).toBeLessThanOrEqual(6000);
  await ctx.close();

  // Polling de fallback: sem WebSocket/Socket.IO a posição ainda atualiza em poucos segundos
  const c = await paidOrderAt(customer, manager, QR.mesa8, [{ name: 'Batata Frita', quantity: 1 }]);
  const d = await paidOrderAt(customer, manager, QR.mesa8, [{ name: 'Gin Tônica', quantity: 1 }]);
  const ctx2 = await newClientContext(browser, { email: ACCOUNTS.client.email });
  await ctx2.route('**/socket.io/**', route => route.abort());
  await ctx2.addInitScript(() => { Object.defineProperty(window, 'WebSocket', { value: undefined, configurable: true }); });
  const page2 = await ctx2.newPage();
  await openClient(page2);
  await nav(page2, 'Pedidos');
  await page2.getByRole('button', { name: new RegExp(`Pedido #${d.number}`) }).click();
  const before = await posOf(d.id);
  await expect(page2.getByTestId('queue-position-value')).toHaveText(`${before.position}º`);
  const t1 = Date.now();
  await advance(c.id, 'preparing', 'ready', 'delivered');
  const after = await posOf(d.id);
  expect(after.ordersAhead).toBeLessThan(before.ordersAhead);
  const expectedPolled = after.position === null ? '—' : `${after.position}º`;
  const polled = await elapsedUntil(t1, async () => (await page2.getByTestId('queue-position-value').innerText()) === expectedPolled, 15_000, 100);
  expect(polled).toBeLessThanOrEqual(7000);
  await ctx2.close();
  // Pedido de outra pessoa não expõe posição
  const other = await Api.as(ACCOUNTS.client2.email);
  expect((await other.get(`orders/${d.id}/queue-position`)).status).toBeClientError();
});

test('07 · onboarding: 3 telas puláveis no primeiro acesso, lembradas por conta (outro aparelho não repete)', async ({ browser }) => {
  const acc = await createDisposableAccount();
  const ctx = await newClientContext(browser, { email: acc.email, password: acc.password, fresh: true, keepOnboarding: true });
  const page = await ctx.newPage();
  await page.goto('/');
  const overlay = page.getByTestId('onboarding');
  await expect(overlay).toBeVisible({ timeout: 20_000 });
  await expect(overlay.getByRole('heading', { name: 'Escaneie o QR da mesa' })).toBeVisible();
  await overlay.getByRole('button', { name: 'Próximo' }).click();
  await expect(overlay.getByRole('heading', { name: 'Peça e pague pelo celular' })).toBeVisible();
  await overlay.getByRole('button', { name: 'Próximo' }).click();
  await expect(overlay.getByRole('heading', { name: 'Receba o aviso quando ficar pronto' })).toBeVisible();
  await overlay.getByRole('button', { name: 'Começar' }).click();
  await expect(overlay).toHaveCount(0);
  expect((await acc.api.get('me/onboarding')).body.completed).toBe(true);
  expect((await dbOne<any>('select onboarding_completed_at from users where id=$1', [acc.id]))!.onboarding_completed_at).not.toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Início' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('onboarding')).toHaveCount(0);
  await ctx.close();
  // Outro "aparelho" (contexto novo, outro armazenamento local) com a mesma conta: não repete
  const ctx2 = await newClientContext(browser, { email: acc.email, password: acc.password, fresh: true, keepOnboarding: true });
  const page2 = await ctx2.newPage();
  await page2.goto('/');
  await expect(page2.getByRole('button', { name: 'Início' })).toBeVisible({ timeout: 20_000 });
  await expect(page2.getByTestId('onboarding')).toHaveCount(0);
  await ctx2.close();

  // Pular na 1ª tela também conta como visto
  const skipper = await createDisposableAccount();
  const ctx3 = await newClientContext(browser, { email: skipper.email, password: skipper.password, fresh: true, keepOnboarding: true });
  const page3 = await ctx3.newPage();
  await page3.goto('/');
  await page3.getByTestId('onboarding').getByRole('button', { name: 'Pular' }).click();
  await expect(page3.getByTestId('onboarding')).toHaveCount(0);
  expect((await skipper.api.get('me/onboarding')).body.completed).toBe(true);
  await page3.reload();
  await expect(page3.getByRole('button', { name: 'Início' })).toBeVisible({ timeout: 15_000 });
  await expect(page3.getByTestId('onboarding')).toHaveCount(0);
  await ctx3.close();
  // Endpoint idempotente e só para a própria conta
  expect((await acc.api.post('me/onboarding/complete', {})).status).toBeLessThan(300);
  expect((await (await Api.create()).get('me/onboarding')).status).toBe(401);
});

test('14 · FilaZero Club: crédito só após entrega, resgate 100 pts = R$ 5, saldo nunca negativo, estorno devolve pontos', async ({ browser }) => {
  test.setTimeout(240_000);
  const acc = await createDisposableAccount({ name: 'Cliente Club E2E' });
  await verifyEmail(acc);
  const xburger = await itemByName(manager, 'X-Burger');
  const batata = await itemByName(manager, 'Batata Frita');
  const loyalty = async () => (await acc.api.get('me/loyalty')).body;

  expect((await loyalty()).balancePoints).toBe(0);
  // Pedido de R$ 115,60 → 115 pontos, mas só depois de ENTREGUE
  const o1 = await createOrder(acc.api, { establishmentId: SEED.mestre, items: [{ menuItemId: xburger.id, quantity: 4 }] });
  expect(o1.body.totalCents).toBe(11560);
  expect((await payApproved(acc.api, o1.body.id, o1.body.totalCents)).status).toBeLessThan(300);
  expect((await loyalty()).balancePoints, 'pago mas não entregue: ainda sem crédito').toBe(0);
  await advance(o1.body.id, 'preparing', 'ready');
  expect((await loyalty()).balancePoints, 'pronto mas não entregue: ainda sem crédito').toBe(0);
  await advance(o1.body.id, 'delivered');
  await expect.poll(async () => (await loyalty()).balancePoints, { timeout: 10_000 }).toBe(115);
  const l = await loyalty();
  expect(l.eligible).toBe(true);
  expect(l.balanceValueCents).toBe(500);
  expect(l.entries.filter((e: any) => e.type === 'earn' && e.orderNumber === o1.body.number)).toHaveLength(1);
  const ledger = await dbQuery<any>("select type, points from loyalty_ledger where order_id=$1", [o1.body.id]);
  expect(ledger).toEqual([{ type: 'earn', points: 115 }]); // idempotente: um registro por pedido+tipo

  // Regras de resgate no servidor: acima do saldo, não múltiplo de 100
  const bad = await createOrder(acc.api, { establishmentId: SEED.mestre, items: [{ menuItemId: batata.id, quantity: 1 }], redeemPoints: 200 } as any);
  expect(bad.status).toBe(422);
  expect(bad.body.code).toBe('INVALID_REDEEM');
  const bad2 = await createOrder(acc.api, { establishmentId: SEED.mestre, items: [{ menuItemId: batata.id, quantity: 1 }], redeemPoints: 50 } as any);
  expect(bad2.status).toBe(422);

  // UI: tela do Club, resgate no pagamento
  const ctx = await newClientContext(browser, { email: acc.email, password: acc.password, fresh: true });
  const page = await ctx.newPage();
  await openClient(page);
  await nav(page, 'Perfil');
  await page.getByRole('button', { name: /FilaZero Club/ }).click();
  await expect(page.getByTestId('club-balance')).toHaveText('115 pts');
  await expect(page.getByTestId('club-balance-value')).toContainText(brlRe(500));
  await expect(page.getByTestId('club-entry').first()).toContainText(`Pedido #${o1.body.number}`);
  await track(QR.mesa1);
  await page.goto(`/?mesa=${QR.mesa1}`);
  await page.getByRole('button', { name: 'Entrar no bar' }).click();
  await nav(page, 'Cardápio');
  await addItem(page, 'Batata Frita', 1);
  await openCart(page);
  await page.getByRole('button', { name: /Confirmar pedido/ }).click();
  await expect(page.getByTestId('redeem-box')).toBeVisible();
  await page.getByRole('button', { name: 'Usar mais pontos' }).click();
  await expect(page.getByTestId('redeem-points')).toHaveText('100 pts');
  await expect(page.getByTestId('redeem-discount')).toContainText(brlRe(500));
  await expect(page.getByTestId('payable-total')).toContainText(brlRe(1700));
  await payWithCard(page, 'sim_approved');
  await expect(page.getByText('Pagamento confirmado')).toBeVisible({ timeout: 15_000 });
  const mine = (await acc.api.get('orders', { pageSize: 5 })).body.items.find((x: any) => x.redeemedPoints === 100);
  expect(mine.totalCents).toBe(1700);
  expect(mine.discountCents).toBe(500);
  await expect.poll(async () => (await loyalty()).balancePoints).toBe(15);
  expect((await loyalty()).entries.some((e: any) => e.type === 'redeem' && e.points === -100)).toBe(true);
  // Não dá para resgatar mais do que o saldo restante (15 pts): caixa de resgate some
  // Cancelar antes do preparo estorna o pagamento e devolve os pontos resgatados
  const cancel = await acc.api.post(`orders/${mine.id}/cancel`);
  expect(cancel.status).toBeLessThan(300);
  await expect.poll(async () => (await loyalty()).balancePoints).toBe(115);
  const types = (await loyalty()).entries.map((e: any) => e.type);
  expect(types).toContain('redeem_return');
  expect((await loyalty()).balancePoints).toBeGreaterThanOrEqual(0);
  const dup = await dbQuery<any>('select type, count(*)::int as n from loyalty_ledger where user_id=$1 group by type having count(*) > 1', [acc.id]);
  expect(dup, 'razão sem duplicidade por tipo').toEqual([]);
  await ctx.close();
});

test('10 · cancelar pedido (cliente): pago antes do preparo estorna; depois do preparo não cancela; pedido de outro dá 404', async ({ browser }) => {
  await track(QR.mesa10);
  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();
  await openClient(page);
  const o = await paidOrderAt(customer, manager, QR.mesa10, [{ name: 'Gin Tônica', quantity: 1 }]);
  await nav(page, 'Pedidos');
  await page.getByRole('button', { name: new RegExp(`Pedido #${o.number}`) }).click();
  await page.getByRole('button', { name: 'Cancelar pedido', exact: true }).click();
  await page.getByRole('button', { name: 'Manter pedido' }).click(); // desistir não cancela
  expect((await dbOne<any>('select status from orders where id=$1', [o.id]))!.status).toBe('paid');
  await page.getByRole('button', { name: 'Cancelar pedido', exact: true }).click();
  await page.getByRole('button', { name: 'Cancelar pedido', exact: true }).last().click(); // botão da folha de confirmação
  await expect(page.getByText('Pedido cancelado — pagamento estornado').first()).toBeVisible({ timeout: 10_000 });
  expect((await dbOne<any>('select status from orders where id=$1', [o.id]))!.status).toBe('cancelled');
  expect((await dbQuery<any>('select status from payments where order_id=$1', [o.id])).map(p => p.status)).toEqual(['refunded']);
  expect((await customer.post(`orders/${o.id}/cancel`)).status).toBeClientError(); // já cancelado

  // Depois que o preparo começa, o cliente não cancela (UI e API)
  const p = await paidOrderAt(customer, manager, QR.mesa10, [{ name: 'Gin Tônica', quantity: 1 }]);
  await advance(p.id, 'preparing');
  await page.reload();
  await nav(page, 'Pedidos');
  await page.getByRole('button', { name: new RegExp(`Pedido #${p.number}`) }).click();
  await expect(page.getByText('Em preparo').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancelar pedido', exact: true })).toHaveCount(0);
  const refused = await customer.post(`orders/${p.id}/cancel`);
  expect(refused.status).toBe(409);
  expect(refused.body.code).toBe('ORDER_NOT_CANCELLABLE');
  // Outro cliente não cancela pedido alheio
  const other = await Api.as(ACCOUNTS.client2.email);
  expect([403, 404]).toContain((await other.post(`orders/${p.id}/cancel`)).status);
  // Só a equipe autorizada cancela depois do preparo (gestor sim, atendente não)
  expect((await (await Api.as(ACCOUNTS.attendant.email)).post(`${base}/orders/${p.id}/cancel`)).status).toBeClientError();
  expect((await manager.post(`${base}/orders/${p.id}/cancel`)).status).toBeLessThan(300);

  // Pedido ainda não pago (received) também pode ser cancelado pelo cliente
  const item = await itemByName(manager, 'Gin Tônica');
  const unpaid = await createOrder(customer, { establishmentId: SEED.mestre, tableId: await track(QR.mesa10), items: [{ menuItemId: item.id, quantity: 1 }] });
  expect(unpaid.body.cancellable).toBe(true);
  expect((await customer.post(`orders/${unpaid.body.id}/cancel`)).status).toBeLessThan(300);
  expect((await dbOne<any>('select status from orders where id=$1', [unpaid.body.id]))!.status).toBe('cancelled');
  await ctx.close();
});

test('18 · chamado de garçom (cliente): botão reflete o chamado aberto e avisa quando a equipe atende', async ({ browser }) => {
  const tableId = await track(QR.mesa5);
  const open = await customer.get('table-calls/mine', { tableId });
  if (open.body?.call) await manager.post(`${base}/tables/${tableId}/calls/resolve`);
  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();
  await enterTableByLink(page, QR.mesa5);
  await page.getByRole('button', { name: 'Chamar atendente' }).click();
  await expect(page.getByText('Atendente chamado')).toBeVisible();
  await expect(page.getByRole('button', { name: /Chamado enviado/ })).toBeDisabled();
  expect((await dbQuery<any>('select id from table_calls where table_id=$1 and resolved_at is null', [tableId])).length).toBe(1);
  // Equipe vê e atende (UI do atendente)
  const staffCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const staff = await staffCtx.newPage();
  await staff.goto('/atendente');
  await staff.getByRole('button', { name: 'Chamados', exact: true }).click();
  await staff.getByRole('button', { name: /Atender chamado da/ }).first().click();
  await expect(page.getByText('Seu chamado foi atendido')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Chamar atendente' })).toBeEnabled();
  await staffCtx.close();
  await ctx.close();
});

test('14 · FilaZero Club ao vivo: com a tela aberta, o saldo e o extrato atualizam sozinhos quando o pedido é entregue (loyalty.updated)', async ({ browser }) => {
  test.setTimeout(120_000);
  const acc = await createDisposableAccount({ name: 'Cliente Club Ao Vivo' });
  await verifyEmail(acc);
  const batata = await itemByName(manager, 'Batata Frita');
  const o = await createOrder(acc.api, { establishmentId: SEED.mestre, items: [{ menuItemId: batata.id, quantity: 1 }] });
  expect((await payApproved(acc.api, o.body.id, o.body.totalCents)).status).toBeLessThan(300);
  const points = Math.floor(o.body.totalCents / 100);
  expect(points).toBeGreaterThan(0);

  const ctx = await newClientContext(browser, { email: acc.email, password: acc.password, fresh: true });
  const page = await ctx.newPage();
  // Só vale o evento depois que o socket entrou na sala da conta (realtime.ready autenticado).
  const roomJoined = new Promise<void>(resolve => {
    page.on('websocket', ws => ws.on('framereceived', frame => {
      const text = String(frame.payload);
      if (text.includes('realtime.ready') && text.includes('"authenticated":true')) resolve();
    }));
  });
  await openClient(page);
  await nav(page, 'Perfil');
  await page.getByRole('button', { name: /FilaZero Club/ }).click();
  await expect(page.getByTestId('club-balance')).toHaveText('0 pts');
  await roomJoined;

  // Sem navegar, recarregar ou reabrir a tela: pago e pronto ainda não creditam; ao entregar, o evento atualiza a tela.
  let navigations = 0;
  page.on('framenavigated', frame => frame === page.mainFrame() && navigations++);
  const before = navigations;
  for (const status of ['preparing', 'ready']) expect((await manager.patch(`${base}/orders/${o.body.id}/status`, { status })).status).toBe(200);
  await expect(page.getByTestId('club-balance')).toHaveText('0 pts');
  const t0 = Date.now();
  expect((await manager.patch(`${base}/orders/${o.body.id}/status`, { status: 'delivered' })).status).toBe(200);
  const ms = await elapsedUntil(t0, async () => (await page.getByTestId('club-balance').innerText()) === `${points} pts`, 4_500, 100);
  expect(ms, 'o saldo muda por evento, antes de qualquer polling/recarga').toBeLessThanOrEqual(4_000);
  await expect(page.getByTestId('club-entry').first()).toContainText(`Pedido #${o.body.number}`);
  expect(navigations).toBe(before);
  await ctx.close();
});
