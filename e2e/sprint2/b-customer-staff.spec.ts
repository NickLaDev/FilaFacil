import { expect, test, type Page } from '@playwright/test';
import { Api, createOrder, menuItems, payApproved, qr } from '../support/api';
import { ACCOUNTS, QR, SEED } from '../support/env';
import { dbOne, dbQuery } from '../support/db';
import { addItem, openCart, payWithCard } from '../support/client-flow';
import { enterTableByLink, nav, newClientContext, newStaffContext } from '../support/ui';
import { clientApi, managerApi, releaseTable } from '../support/domain';
import { elapsedUntil, recordMetric } from '../support/metrics';

// Cenário B — cliente + equipe em dois contextos de navegador independentes (fichas 09, 04, 16). Tempo real e fallback.

let manager: Api;
let items: any[];
const item = (n: string) => items.find(i => i.name === n);
const tables = new Set<string>();

test.beforeAll(async () => {
  manager = await managerApi();
  items = await menuItems(manager, SEED.mestre);
});
test.afterAll(async () => {
  for (const t of tables) await releaseTable(manager, SEED.mestre, t);
});

/** Etapa atual da linha do tempo do cliente (texto em destaque primário). */
const currentStep = (page: Page, label: string) => page.locator('p.text-primary', { hasText: new RegExp(`^${label}$`) });
const orderCard = (staff: Page, number: number) => staff.locator('article', { has: staff.getByText(`#${number}`, { exact: true }) });

test('B1 · cliente paga → equipe vê → avança status → cliente vê cada mudança SEM recarregar (≤ 5 s)', async ({ browser }) => {
  const tid = (await qr(manager, QR.mesa5)).tableId;
  tables.add(tid);
  const customerCtx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const staffCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const customer = await customerCtx.newPage();
  const staff = await staffCtx.newPage();
  let customerNavigations = 0;
  customer.on('framenavigated', f => f === customer.mainFrame() && customerNavigations++);
  let websocketsOpened = 0;
  customer.on('websocket', () => websocketsOpened++);

  await staff.goto('/atendente');
  await staff.getByRole('button', { name: 'Pedidos' }).click();
  await expect(staff.getByText('Bar do Mestre · Carlos Mendes')).toBeVisible({ timeout: 15_000 });

  // Cliente monta o pedido na mesa 5 e paga
  await enterTableByLink(customer, QR.mesa5);
  await nav(customer, 'Cardápio');
  await addItem(customer, 'X-Burger', 1, 'Sem cebola');
  await openCart(customer);
  await customer.getByRole('button', { name: /Confirmar pedido/ }).click();
  const tPay = Date.now();
  await payWithCard(customer, 'sim_approved');
  await expect(customer.getByText('Pagamento confirmado')).toBeVisible({ timeout: 15_000 });
  const number = Number(/PEDIDO #(\d+)/.exec(await customer.locator('h1').innerText())![1]);
  await customer.getByRole('button', { name: 'Acompanhar pedido' }).click();
  await customer.evaluate(() => ((window as any).__e2eMarker = 'sem-reload'));
  const navsBefore = customerNavigations;

  // Equipe vê o pedido pago, com mesa e item, sem recarregar
  const card = orderCard(staff, number);
  const staffSees = await elapsedUntil(tPay, async () => (await card.count()) > 0, 10_000);
  recordMetric('ficha 09/04: pagamento → pedido aparece na tela da equipe', staffSees, 5000);
  expect(staffSees).toBeLessThanOrEqual(5000);
  await expect(card).toContainText('Pago · novo');
  await expect(card).toContainText('Mesa 5');
  await expect(card).toContainText('1× X-Burger');
  await expect(card).toContainText('Sem cebola');

  // Iniciar preparo → cliente vê "Em preparo"
  let t0 = Date.now();
  await card.getByRole('button', { name: 'Iniciar preparo' }).click();
  let ms = await elapsedUntil(t0, async () => (await currentStep(customer, 'Em preparo').count()) > 0, 12_000, 50);
  recordMetric('ficha 09: equipe "Iniciar preparo" → cliente vê "Em preparo"', ms, 5000);
  expect(ms).toBeLessThanOrEqual(5000);
  expect((await dbOne<any>('select status from orders where number=$1', [number]))!.status).toBe('preparing');

  // Marcar como pronto → cliente vê tela "pronto" com código de retirada
  t0 = Date.now();
  await card.getByRole('button', { name: 'Marcar como pronto' }).click();
  ms = await elapsedUntil(t0, async () => (await customer.getByText('Seu pedido está pronto!').count()) > 0, 12_000, 50);
  recordMetric('ficha 09: equipe "Marcar como pronto" → cliente vê "pronto"', ms, 5000);
  expect(ms).toBeLessThanOrEqual(5000);
  const code = (await dbOne<any>('select pickup_code from orders where number=$1', [number]))!.pickup_code;
  await expect(customer.getByText(code, { exact: true })).toBeVisible();
  await expect(card).toContainText(`Código de retirada: ${code}`);

  // Entregue → linha do tempo concluída
  t0 = Date.now();
  await card.getByRole('button', { name: 'Marcar como entregue' }).click();
  ms = await elapsedUntil(t0, async () => (await customer.getByText('Seu pedido está pronto!').count()) === 0, 12_000, 50);
  recordMetric('ficha 09: equipe "Marcar como entregue" → cliente vê concluído', ms, 5000);
  expect(ms).toBeLessThanOrEqual(5000);
  expect((await dbOne<any>('select status from orders where number=$1', [number]))!.status).toBe('delivered');

  // Nenhuma navegação/recarga na tela do cliente; marcador em memória continua
  expect(websocketsOpened, 'B1 usa o WebSocket real (B2 prova o caminho sem ele)').toBeGreaterThanOrEqual(1);
  await expect(customer.locator('p.text-primary', { hasText: /^(Pedido recebido|Pagamento confirmado|Em preparo|Pronto para retirada|Entregue)$/ })).toHaveCount(0); // nenhuma etapa "atual": tudo concluído
  await expect(customer.locator('p.text-foreground', { hasText: /^Entregue$/ })).toBeVisible();
  expect(customerNavigations).toBe(navsBefore);
  expect(await customer.evaluate(() => (window as any).__e2eMarker)).toBe('sem-reload');
  // Histórico do cliente mostra entregue
  await nav(customer, 'Pedidos');
  await expect(customer.getByText(`Pedido #${number}`)).toBeVisible();
  await customerCtx.close();
  await staffCtx.close();
});

test('B2 · fallback por polling: sem Socket.IO o cliente ainda recebe a mudança em poucos segundos', async ({ browser }) => {
  const tid = (await qr(manager, QR.mesa8)).tableId;
  tables.add(tid);
  const api = await clientApi();
  const o = await createOrder(api, { establishmentId: SEED.mestre, tableId: tid, items: [{ menuItemId: item('Batata Frita').id, quantity: 1 }] });
  await payApproved(api, o.body.id, o.body.totalCents);

  const customerCtx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  // Falha de rede injetada: nenhuma conexão Socket.IO (websocket nem polling HTTP) chega ao servidor.
  let socketAttempts = 0;
  await customerCtx.route('**/socket.io/**', route => { socketAttempts++; return route.abort(); });
  await customerCtx.addInitScript(() => { Object.defineProperty(window, 'WebSocket', { value: undefined, configurable: true }); }); // sem WebSocket: só restaria polling HTTP, também abortado
  const customer = await customerCtx.newPage();
  await customer.goto('/');
  await nav(customer, 'Pedidos');
  await customer.getByRole('button', { name: new RegExp(`Pedido #${o.body.number}`) }).click();
  await expect(currentStep(customer, 'Pagamento confirmado')).toBeVisible();

  const polled: string[] = [];
  const socketSucceeded: string[] = [];
  let wsOpened = 0;
  customer.on('websocket', () => wsOpened++);
  customer.on('requestfinished', r => {
    if (/socket\.io/.test(r.url())) socketSucceeded.push(r.url());
    if (r.method() === 'GET' && /\/api\/orders/.test(r.url()) && Date.now() >= t0) polled.push(`${Date.now() - t0}ms:${r.url().split('/api')[1]}`);
  });
  const t0 = Date.now();
  const adv = await manager.patch(`establishments/${SEED.mestre}/orders/${o.body.id}/status`, { status: 'preparing' });
  expect(adv.status).toBe(200);
  const ms = await elapsedUntil(t0, async () => (await currentStep(customer, 'Em preparo').count()) > 0, 15_000, 100).catch(e => { throw new Error(`${e.message}; requisições /orders observadas: ${polled.join(' | ') || 'nenhuma'}`); });
  recordMetric('ficha 09: fallback polling (sem WebSocket) → cliente vê "Em preparo"', ms, 5000);
  // Prova positiva: o socket estava mesmo fora do ar e a mudança chegou SÓ por consulta (polling) à API.
  test.info().annotations.push({ type: 'socket.io', description: `${socketAttempts} tentativa(s) abortada(s) pela injeção; sem WebSocket no navegador o cliente nem chega a tentar` });
  expect(socketSucceeded, 'nenhuma requisição Socket.IO pode ter concluído').toEqual([]);
  expect(wsOpened, 'nenhum WebSocket aberto').toBe(0);
  expect(polled.length, `ao menos uma consulta GET /orders após a mudança (vistas: ${polled.join(' | ') || 'nenhuma'})`).toBeGreaterThanOrEqual(1);
  expect(ms).toBeLessThanOrEqual(5000);
  await customerCtx.close();
});

test('B3 · permissões e operações conflitantes na fila de pedidos', async ({ browser }) => {
  const tid = (await qr(manager, QR.mesa10)).tableId;
  tables.add(tid);
  const api = await clientApi();
  const o = await createOrder(api, { establishmentId: SEED.mestre, tableId: tid, items: [{ menuItemId: item('Gin Tônica').id, quantity: 1 }] });
  await payApproved(api, o.body.id, o.body.totalCents);
  const base = `establishments/${SEED.mestre}/orders/${o.body.id}`;

  // Cliente não avança status nem estorna; anônimo recebe 401
  expect([401, 403, 404]).toContain((await api.patch(`${base}/status`, { status: 'preparing' })).status);
  expect([401, 403, 404]).toContain((await api.post(`${base}/refund`)).status);
  expect((await (await Api.create()).patch(`${base}/status`, { status: 'preparing' })).status).toBe(401);
  // Transição inválida (paid → ready) e inexistente
  const bad = await manager.patch(`${base}/status`, { status: 'ready' });
  expect(bad.status).toBeClientError();
  expect((await manager.patch(`${base}/status`, { status: 'delivered' })).status).toBeClientError();
  expect((await manager.patch(`${base}/status`, { status: 'voando' })).status).toBeClientError();
  expect((await dbOne<any>('select status from orders where id=$1', [o.body.id]))!.status).toBe('paid');
  // Equipe de OUTRO estabelecimento (Paula, Cantina) não enxerga nem altera pedidos do Bar do Mestre
  const paula = await Api.as(ACCOUNTS.managerStart.email);
  expect([403, 404]).toContain((await paula.patch(`${base}/status`, { status: 'preparing' })).status);
  expect([403, 404]).toContain((await paula.get(`establishments/${SEED.mestre}/orders`)).status);
  expect((await dbOne<any>('select status from orders where id=$1', [o.body.id]))!.status).toBe('paid');

  // UI: atendente (sem orders.refund) não vê estorno; gestor vê e estorna → cliente vê cancelado/estornado
  const attCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const att = await attCtx.newPage();
  await att.goto('/atendente');
  await att.getByRole('button', { name: 'Pedidos' }).click();
  await expect(orderCard(att, o.body.number)).toBeVisible({ timeout: 15_000 });
  await expect(att.getByLabel(`Estornar pedido ${o.body.number}`)).toHaveCount(0);
  await expect(att.getByRole('button', { name: 'Iniciar preparo' }).first()).toBeVisible();
  expect((await (await Api.as(ACCOUNTS.attendant.email)).post(`${base}/refund`)).status).toBe(403);

  const mgrCtx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const mgr = await mgrCtx.newPage();
  await mgr.goto('/atendente');
  await mgr.getByRole('button', { name: 'Pedidos' }).click();
  const customerCtx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const customer = await customerCtx.newPage();
  await customer.goto('/');
  await nav(customer, 'Pedidos');
  await customer.getByRole('button', { name: new RegExp(`Pedido #${o.body.number}`) }).click();
  await expect(currentStep(customer, 'Pagamento confirmado')).toBeVisible();
  const t0 = Date.now();
  await mgr.getByLabel(`Estornar pedido ${o.body.number}`).click();
  await expect(customer.getByText('Pedido cancelado — pagamento estornado')).toBeVisible({ timeout: 10_000 });
  recordMetric('estorno pela equipe → cliente vê "cancelado — estornado"', Date.now() - t0, 5000);
  expect(await dbQuery('select status from payments where order_id=$1', [o.body.id])).toEqual([{ status: 'refunded' }]);
  expect((await dbOne<any>('select status from orders where id=$1', [o.body.id]))!.status).toBe('cancelled');
  // Segundo estorno e avanço de pedido cancelado são recusados
  expect((await manager.post(`${base}/refund`)).status).toBeClientError();
  expect((await manager.patch(`${base}/status`, { status: 'preparing' })).status).toBeClientError();
  // Comprovante continua no histórico, marcado como estornado
  await customer.getByRole('button', { name: 'Ver comprovante' }).click();
  await expect(customer.getByText('Estornado')).toBeVisible();
  await expect(customer.getByText('Transação simulada — sem valor financeiro')).toBeVisible();
  await customerCtx.close();
  await attCtx.close();
  await mgrCtx.close();
});
