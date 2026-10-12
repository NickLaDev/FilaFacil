import { expect, test } from '@playwright/test';
import { Api, createOrder, menuItems, payApproved, qr } from '../support/api';
import { ACCOUNTS, QR, SEED } from '../support/env';
import { dbOne, dbQuery } from '../support/db';
import { addItem, cartLine, expectCartTotal, openCart, payWithCard } from '../support/client-flow';
import { brlRe, enterTableByLink, newClientContext, nav, otpMark, typeCode, waitForOtp } from '../support/ui';
import { Disposable, clientApi, createDisposableAccount, managerApi, releaseTable } from '../support/domain';

// Cenário A — pedido do cliente de ponta a ponta (fichas 02, 08, 04, 09, 65). Real: front + API + PostgreSQL.

let items: any[];
let manager: Api;
const item = (name: string) => items.find(i => i.name === name);
const usedTables = new Set<string>();

test.beforeAll(async () => {
  const api = await Api.create();
  items = await menuItems(api, SEED.mestre);
  manager = await managerApi();
});
test.afterAll(async () => {
  for (const t of usedTables) await releaseTable(manager, SEED.mestre, t);
});

async function tableId(code: string) {
  const t = (await qr(manager, code)).tableId as string;
  usedTables.add(t);
  return t;
}
const orderCount = async (email: string) => Number((await dbOne<{ c: string }>('select count(*) c from orders o join users u on u.id=o.user_id where u.email=$1', [email]))!.c);

test('A1 · carrinho ao vivo → pagamento aprovado → confirmação, rastreio, histórico, comprovante e persistência', async ({ browser }) => {
  await tableId(QR.mesa1);
  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();

  // Ficha 02: link do QR da mesa leva à confirmação do bar certo (mesa 1)
  const t0 = Date.now();
  await enterTableByLink(page, QR.mesa1);
  await expect(page.getByText('Mesa 1').first()).toBeVisible();
  await nav(page, 'Cardápio');
  await expect(page.getByText('Bar do Mestre · Mesa 1')).toBeVisible();
  test.info().annotations.push({ type: 'latência ficha 02 (link do QR → cardápio da mesa)', description: `${Date.now() - t0} ms` });
  expect(Date.now() - t0, 'ficha 02: cardápio da mesa em até 3 s').toBeLessThanOrEqual(3000);

  // Ficha 08: total ao vivo a cada alteração
  await addItem(page, 'Cerveja IPA 600ml', 2);
  await addItem(page, 'X-Burger', 1, 'Sem cebola');
  await openCart(page);
  const ipaP = item('Cerveja IPA 600ml').finalPriceCents, burgerP = item('X-Burger').finalPriceCents;
  await expectCartTotal(page, ipaP * 2 + burgerP);
  await cartLine(page, 'Cerveja IPA 600ml').getByLabel('Aumentar').click();
  await expectCartTotal(page, ipaP * 3 + burgerP);
  await cartLine(page, 'Cerveja IPA 600ml').getByLabel('Diminuir').click();
  await cartLine(page, 'Cerveja IPA 600ml').getByLabel('Diminuir').click();
  await expectCartTotal(page, ipaP + burgerP);
  await cartLine(page, 'X-Burger').getByLabel('Remover X-Burger').click();
  await expectCartTotal(page, ipaP);
  await page.getByRole('button', { name: /Confirmar pedido/ }).click();

  // Ficha 04: pagamento simulado aprovado
  await expect(page.getByText('Pagamento simulado').first()).toBeVisible();
  await payWithCard(page, 'sim_approved');
  await expect(page.getByText('Pagamento confirmado')).toBeVisible({ timeout: 15_000 });
  const number = Number(/PEDIDO #(\d+)/.exec(await page.locator('h1').innerText())![1]);
  await expect(page.getByText('Bar do Mestre · Mesa 1')).toBeVisible();

  // Persistência: pedido, itens e pagamento no banco filafacil_e2e
  const order = await dbOne<any>('select o.id, o.status, o.total_cents, o.table_label, o.table_id, u.email from orders o join users u on u.id=o.user_id where o.number=$1', [number]);
  expect(order).toMatchObject({ status: 'paid', total_cents: ipaP, table_label: 'Mesa 1', email: ACCOUNTS.client.email });
  expect(await dbQuery('select status, amount_cents, method from payments where order_id=$1', [order.id])).toEqual([{ status: 'approved', amount_cents: ipaP, method: 'credit' }]);
  expect(await dbQuery('select name, quantity, unit_price_cents, notes from order_items where order_id=$1', [order.id])).toEqual([{ name: 'Cerveja IPA 600ml', quantity: 1, unit_price_cents: ipaP, notes: '' }]);

  // Ficha 09: rastreio com linha do tempo, resumo e total
  await page.getByRole('button', { name: 'Acompanhar pedido' }).click();
  for (const step of ['Pedido recebido', 'Pagamento confirmado', 'Em preparo', 'Pronto para retirada', 'Entregue']) await expect(page.getByText(step, { exact: true })).toBeVisible();
  await expect(page.getByText(`#${number}`).first()).toBeVisible();
  await expect(page.getByText(/\d+–\d+ min/)).toBeVisible(); // tempo estimado (ficha 09)
  await expect(page.getByText(/Retirada: \S+/)).toBeVisible(); // local de retirada (ficha 09)
  await expect(page.getByText('1× Cerveja IPA 600ml')).toBeVisible();
  await expect(page.getByText('Total', { exact: true }).locator('..')).toContainText(brlRe(ipaP));

  // Ficha 04: comprovante no histórico
  await page.getByRole('button', { name: 'Ver comprovante' }).click();
  await expect(page.getByText('Aprovado')).toBeVisible();
  await expect(page.getByText('Transação simulada — sem valor financeiro')).toBeVisible();
  await nav(page, 'Pedidos');
  await expect(page.getByText(`Pedido #${number}`)).toBeVisible();
  await ctx.close();
});

test('A2 · pagamento recusado mantém carrinho e pedido; nova tentativa aprova no MESMO pedido', async ({ browser }) => {
  await tableId(QR.mesa5);
  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();
  const before = await orderCount(ACCOUNTS.client.email);
  await enterTableByLink(page, QR.mesa5);
  await nav(page, 'Cardápio');
  await addItem(page, 'Heineken Long Neck', 1);
  await openCart(page);
  await page.getByRole('button', { name: /Confirmar pedido/ }).click();
  await payWithCard(page, 'sim_refused', 'debit');
  await expect(page.getByText('Pagamento não concluído')).toBeVisible();
  await expect(page.getByText(/Nenhum valor foi cobrado e seu carrinho foi mantido/)).toBeVisible();
  const row = await dbOne<any>("select o.id, o.status from orders o join users u on u.id=o.user_id where u.email=$1 order by o.number desc limit 1", [ACCOUNTS.client.email]);
  expect(row.status).toBe('received'); // não foi para a cozinha
  expect(await dbQuery("select status from payments where order_id=$1", [row.id])).toEqual([{ status: 'refused' }]);
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await payWithCard(page, 'sim_approved', 'debit');
  await expect(page.getByText('Pagamento confirmado')).toBeVisible({ timeout: 15_000 });
  expect(await orderCount(ACCOUNTS.client.email)).toBe(before + 1); // um único pedido
  expect(await dbQuery("select attempt, status from payments where order_id=$1 order by attempt", [row.id])).toEqual([{ attempt: 1, status: 'refused' }, { attempt: 2, status: 'approved' }]);
  expect((await dbOne<any>('select status from orders where id=$1', [row.id]))!.status).toBe('paid');
  await ctx.close();
});

test('A3 · falha de processamento do gateway não cobra nem avança o pedido; retry funciona', async ({ browser }) => {
  await tableId(QR.mesa8);
  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();
  await enterTableByLink(page, QR.mesa8);
  await nav(page, 'Cardápio');
  await addItem(page, 'Batata Frita', 1);
  await openCart(page);
  await page.getByRole('button', { name: /Confirmar pedido/ }).click();
  await payWithCard(page, 'sim_error');
  await expect(page.getByText('Pagamento não concluído')).toBeVisible();
  const row = await dbOne<any>('select o.id, o.status from orders o join users u on u.id=o.user_id where u.email=$1 order by o.number desc limit 1', [ACCOUNTS.client.email]);
  expect(row.status).toBe('received');
  expect((await dbQuery<any>("select status from payments where order_id=$1 and status='approved'", [row.id])).length).toBe(0);
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await payWithCard(page, 'sim_approved');
  await expect(page.getByText('Pagamento confirmado')).toBeVisible({ timeout: 15_000 });
  expect((await dbOne<any>('select status from orders where id=$1', [row.id]))!.status).toBe('paid');
  await ctx.close();
});

test('A4 · Pix simulado: gera cobrança pendente e "Simular pagamento do Pix" confirma o pedido', async ({ browser }) => {
  await tableId(QR.mesa10);
  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();
  await enterTableByLink(page, QR.mesa10);
  await nav(page, 'Cardápio');
  await addItem(page, 'Gin Tônica', 1);
  await openCart(page);
  await page.getByRole('button', { name: /Confirmar pedido/ }).click();
  await page.getByRole('button', { name: 'Gerar Pix' }).click();
  await expect(page.getByText('Pix simulado — não pagável')).toBeVisible();
  await expect(page.getByText(/SIMULADO-NAO-PAGAVEL/)).toBeVisible();
  const row = await dbOne<any>('select o.id, o.status from orders o join users u on u.id=o.user_id where u.email=$1 order by o.number desc limit 1', [ACCOUNTS.client.email]);
  expect(row.status).toBe('received');
  expect(await dbQuery('select status, method from payments where order_id=$1', [row.id])).toEqual([{ status: 'pending', method: 'pix' }]);
  await page.getByRole('button', { name: 'Simular pagamento do Pix' }).click();
  await expect(page.getByText('Pagamento confirmado')).toBeVisible({ timeout: 15_000 });
  expect((await dbOne<any>('select status from orders where id=$1', [row.id]))!.status).toBe('paid');
  expect(await dbQuery('select status, method from payments where order_id=$1', [row.id])).toEqual([{ status: 'approved', method: 'pix' }]);
  await ctx.close();
});

test('A5 · pedido inválido é recusado pela API e nada é gravado', async () => {
  const api = await clientApi();
  const before = await orderCount(ACCOUNTS.client.email);
  const ipa = item('Cerveja IPA 600ml');
  const tid = await tableId(QR.mesa1);
  const bad = async (body: any, expectStatus: number[], code?: string) => {
    const r = await createOrder(api, body);
    expect(expectStatus, JSON.stringify(r.body)).toContain(r.status);
    if (code) expect(r.body.code).toBe(code);
    return r;
  };
  await bad({ establishmentId: SEED.mestre, tableId: tid, items: [] }, [400, 422]);
  await bad({ establishmentId: SEED.mestre, tableId: tid, items: [{ menuItemId: ipa.id, quantity: 0 }] }, [400, 422]);
  await bad({ establishmentId: SEED.mestre, tableId: tid, items: [{ menuItemId: ipa.id, quantity: 21 }] }, [400, 422]);
  await bad({ establishmentId: SEED.mestre, tableId: tid, items: [{ menuItemId: ipa.id, quantity: -1 }] }, [400, 422]);
  await bad({ establishmentId: SEED.mestre, tableId: tid, items: [{ menuItemId: 'nao-e-uuid', quantity: 1 }] }, [400, 422]);
  // item esgotado (X-Bacon, seed)
  await bad({ establishmentId: SEED.mestre, tableId: tid, items: [{ menuItemId: SEED.item(5), quantity: 1 }] }, [409, 422], 'ITEM_UNAVAILABLE');
  // item de outro estabelecimento
  const other = (await menuItems(api, SEED.lancheria))[0];
  await bad({ establishmentId: SEED.mestre, tableId: tid, items: [{ menuItemId: other.id, quantity: 1 }] }, [400, 404, 409, 422]);
  // mesa de outro estabelecimento
  const cantinaTable = (await qr(api, 'CANTINA-1201')).tableId;
  await bad({ establishmentId: SEED.mestre, tableId: cantinaTable, items: [{ menuItemId: ipa.id, quantity: 1 }] }, [400, 404, 409, 422]);
  // total esperado diferente do servidor
  await bad({ establishmentId: SEED.mestre, tableId: tid, expectedTotalCents: ipa.finalPriceCents + 1, items: [{ menuItemId: ipa.id, quantity: 1 }] }, [409, 422], 'PRICE_CHANGED');
  // sem sessão
  const anon = await Api.create();
  expect((await createOrder(anon, { establishmentId: SEED.mestre, items: [{ menuItemId: ipa.id, quantity: 1 }] })).status).toBe(401);
  expect(await orderCount(ACCOUNTS.client.email)).toBe(before);
  // pedido de outra pessoa não é visível nem pagável
  const mine = await createOrder(api, { establishmentId: SEED.mestre, tableId: tid, items: [{ menuItemId: ipa.id, quantity: 1 }] });
  expect(mine.status).toBe(201);
  const stranger = await clientApi(ACCOUNTS.client2);
  expect([403, 404]).toContain((await stranger.get(`orders/${mine.body.id}`)).status);
  expect([403, 404]).toContain((await payApproved(stranger, mine.body.id)).status);
  expect((await dbOne<any>('select status from orders where id=$1', [mine.body.id]))!.status).toBe('received');
});

test('A6 · estabelecimento com pedidos pausados / mesa de QR inválido são recusados', async () => {
  const api = await clientApi();
  const admin = await Api.as(ACCOUNTS.admin.email);
  const boteco = SEED.est(4);
  const botecoItem = (await menuItems(api, boteco))[0];
  try {
    expect((await admin.patch(`admin/establishments/${boteco}`, { ordersPaused: true })).status).toBe(200);
    const r = await createOrder(api, { establishmentId: boteco, items: [{ menuItemId: botecoItem.id, quantity: 1 }] });
    expect(r.status).toBeClientError();
    expect(r.body.code).toBe('ESTABLISHMENT_NOT_ACCEPTING_ORDERS');
  } finally {
    await admin.patch(`admin/establishments/${boteco}`, { ordersPaused: false });
  }
  const inv = await api.get('restaurants/qr/CODIGO-INEXISTENTE');
  expect(inv.status).toBe(404);
});

test('A7 · cliente NÃO verificado não paga (UI e API); só o código correto verifica e libera o pagamento', async ({ browser }) => {
  await tableId(QR.mesa1);
  const acc: Disposable = await createDisposableAccount();
  const ctx = await newClientContext(browser, { email: acc.email, password: acc.password });
  const page = await ctx.newPage();
  await enterTableByLink(page, QR.mesa1);
  await nav(page, 'Cardápio');
  await addItem(page, 'Heineken Long Neck', 1);
  await openCart(page);
  await page.getByRole('button', { name: /Confirmar pedido/ }).click();
  await expect(page.getByText('Confirme sua conta para pagar')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Pagar com|Gerar Pix/ })).toHaveCount(0);

  // API: mesmo forçando o pagamento, o servidor recusa
  const unverified = await Api.as(acc.email, acc.password);
  const created = await createOrder(unverified, { establishmentId: SEED.mestre, items: [{ menuItemId: item('Heineken Long Neck').id, quantity: 1 }] });
  expect(created.status).toBe(201);
  const attempt = await payApproved(unverified, created.body.id);
  expect(attempt.status).toBe(403);
  expect(attempt.body.code).toBe('CONTACT_NOT_VERIFIED');
  expect(await dbQuery("select 1 from payments where order_id=$1", [created.body.id])).toHaveLength(0);
  expect((await dbOne<any>('select email_verified_at from users where id=$1', [acc.id]))!.email_verified_at).toBeNull();

  // código errado não verifica
  const mark = otpMark();
  await page.getByRole('button', { name: 'Verificar agora' }).click();
  const real = await waitForOtp(mark, 'email', { hint: acc.email });
  const wrong = real === '000000' ? '111111' : '000000';
  await typeCode(page, wrong);
  await expect(page.getByText('Código incorreto. Tente novamente.')).toBeVisible();
  expect((await dbOne<any>('select email_verified_at from users where id=$1', [acc.id]))!.email_verified_at).toBeNull();
  // código correto verifica
  await typeCode(page, real);
  await expect(page.getByText('E-mail verificado')).toBeVisible();
  expect((await dbOne<any>('select email_verified_at from users where id=$1', [acc.id]))!.email_verified_at).not.toBeNull();
  // agora paga
  await expect(page.getByRole('button', { name: 'Gerar Pix' })).toBeVisible();
  await payWithCard(page, 'sim_approved');
  await expect(page.getByText('Pagamento confirmado')).toBeVisible({ timeout: 15_000 });
  await ctx.close();
});

test('A8 · pagamento duplicado: segundo pagamento é recusado e só existe UMA cobrança aprovada', async () => {
  const api = await clientApi();
  const tid = await tableId(QR.mesa5);
  const o = await createOrder(api, { establishmentId: SEED.mestre, tableId: tid, items: [{ menuItemId: item('Caipirinha de Limão').id, quantity: 1 }] });
  expect(o.status).toBe(201);
  const first = await payApproved(api, o.body.id, o.body.totalCents);
  expect(first.status).toBeLessThan(300);
  expect(first.body.status).toBe('paid');
  const second = await payApproved(api, o.body.id, o.body.totalCents);
  expect(second.status).toBeClientError();
  expect(['ALREADY_PAID', 'ORDER_NOT_PAYABLE']).toContain(second.body.code);
  expect(await dbQuery("select status from payments where order_id=$1 and status='approved'", [o.body.id])).toHaveLength(1);

  // corrida: dois pagamentos simultâneos do mesmo pedido
  const o2 = await createOrder(api, { establishmentId: SEED.mestre, tableId: tid, items: [{ menuItemId: item('Caipirinha de Limão').id, quantity: 2 }] });
  const [a, b] = await Promise.all([payApproved(api, o2.body.id, o2.body.totalCents), payApproved(api, o2.body.id, o2.body.totalCents)]);
  expect([a.status, b.status].filter(s => s < 300).length, JSON.stringify([a.body, b.body])).toBe(1);
  expect(await dbQuery("select status from payments where order_id=$1 and status='approved'", [o2.body.id])).toHaveLength(1);

  // mesma tentativa de checkout (clientRequestId) não duplica o pedido
  const rid = `e2e-dup-${Date.now()}`;
  const body = { establishmentId: SEED.mestre, tableId: tid, clientRequestId: rid, items: [{ menuItemId: item('Caipirinha de Limão').id, quantity: 1 }] };
  const c1 = await api.post('orders', body);
  const c2 = await api.post('orders', body);
  expect(c1.body.id).toBe(c2.body.id);
  expect(await dbQuery('select 1 from orders where client_request_id=$1', [rid])).toHaveLength(1);
});

test('A9 · preço alterado durante o checkout: valor cobrado = preço vigente exibido; total antigo é recusado', async ({ browser }) => {
  const itm = item('Heineken Long Neck');
  const tid = await tableId(QR.mesa8);
  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();
  await enterTableByLink(page, QR.mesa8);
  await nav(page, 'Cardápio');
  await addItem(page, 'Heineken Long Neck', 2);
  await openCart(page);
  await expectCartTotal(page, itm.finalPriceCents * 2);
  const newPrice = itm.priceCents + 500;
  try {
    // API: pedido criado com total antigo; o gestor muda o preço; pagar com total antigo é recusado
    const api = await clientApi();
    const stale = await createOrder(api, { establishmentId: SEED.mestre, tableId: tid, items: [{ menuItemId: itm.id, quantity: 2 }] });
    expect((await manager.patch(`establishments/${SEED.mestre}/menu/items/${itm.id}`, { priceCents: newPrice })).status).toBe(200);
    // UI: o carrinho aberto reflete o novo preço sem recarregar (tempo real/consulta)
    await expectCartTotal(page, newPrice * 2);
    const pay = await payApproved(api, stale.body.id, stale.body.totalCents);
    expect(pay.status).toBeClientError();
    expect(['ORDER_TOTAL_CHANGED', 'PRICE_CHANGED', 'ORDER_CONTENT_CHANGED']).toContain(pay.body.code);
    expect(await dbQuery("select 1 from payments where order_id=$1 and status='approved'", [stale.body.id])).toHaveLength(0);
    // UI: paga pelo valor novo
    await page.getByRole('button', { name: /Confirmar pedido/ }).click();
    await payWithCard(page, 'sim_approved');
    await expect(page.getByText('Pagamento confirmado')).toBeVisible({ timeout: 15_000 });
    const row = await dbOne<any>('select o.id, o.total_cents from orders o join users u on u.id=o.user_id where u.email=$1 order by o.number desc limit 1', [ACCOUNTS.client.email]);
    expect(row.total_cents).toBe(newPrice * 2);
    expect(await dbQuery("select amount_cents from payments where order_id=$1 and status='approved'", [row.id])).toEqual([{ amount_cents: newPrice * 2 }]);
  } finally {
    await manager.patch(`establishments/${SEED.mestre}/menu/items/${itm.id}`, { priceCents: itm.priceCents });
  }
  await ctx.close();
});

test('A10 · item esgotado enquanto está no carrinho: UI avisa em tempo real e bloqueia a confirmação', async ({ browser }) => {
  const itm = item('Gin Tônica');
  await tableId(QR.mesa10);
  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();
  await enterTableByLink(page, QR.mesa10);
  await nav(page, 'Cardápio');
  await addItem(page, 'Gin Tônica', 1);
  await openCart(page);
  const att = await Api.as(ACCOUNTS.attendant.email);
  try {
    expect((await att.patch(`establishments/${SEED.mestre}/menu/items/${itm.id}/availability`, { available: false })).status).toBe(200);
    await expect(page.getByText('Esgotado — remova para continuar')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: /Confirmar pedido/ })).toBeDisabled();
    const r = await createOrder(await clientApi(), { establishmentId: SEED.mestre, items: [{ menuItemId: itm.id, quantity: 1 }] });
    expect(r.body.code).toBe('ITEM_UNAVAILABLE');
  } finally {
    await att.patch(`establishments/${SEED.mestre}/menu/items/${itm.id}/availability`, { available: true });
  }
  await ctx.close();
});

test('A11 · visitante não conclui pedido: carrinho pede login', async ({ browser }) => {
  const ctx = await newClientContext(browser);
  const page = await ctx.newPage();
  await page.goto(`/?mesa=${QR.mesa1}`);
  await expect(page.getByText('QR Code lido com sucesso')).toBeVisible();
  await page.getByRole('button', { name: 'Entrar no bar' }).click();
  await page.getByRole('button', { name: 'Continuar como visitante' }).click();
  await nav(page, 'Cardápio');
  await addItem(page, 'Heineken Long Neck', 1);
  await openCart(page);
  await expect(page.getByText('Visitantes não podem concluir pedidos.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Confirmar pedido/ })).toHaveCount(0);
  await ctx.close();
});

test('A12 · rastreio de pedido de mesa: local de retirada (captura do comportamento atual × ficha 09)', async ({ browser }) => {
  const tid = await tableId(QR.mesa1);
  const api = await clientApi();
  const paid = await (async () => {
    const o = await createOrder(api, { establishmentId: SEED.mestre, tableId: tid, items: [{ menuItemId: item('Cerveja IPA 600ml').id, quantity: 1 }] });
    return (await payApproved(api, o.body.id, o.body.totalCents)).body;
  })();
  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();
  await page.goto('/');
  await nav(page, 'Pedidos');
  await page.getByRole('button', { name: new RegExp(`Pedido #${paid.number}`) }).click();
  // Ficha 09: "Mostrar tempo estimado e local de retirada" → o local de retirada precisa estar visível.
  await expect(page.getByText(/Retirada:/)).toBeVisible();
  const pickupLine = await page.getByText(/Retirada:/).innerText();
  await expect(page.getByText(/Bar do Mestre · Mesa 1/)).toBeVisible(); // pedido de mesa: a mesa também aparece
  test.info().annotations.push({
    type: 'OBSERVAÇÃO (possível inconsistência)',
    description: `Pedido associado à mesa: API pickupPoint="${paid.pickupPoint}", tableLabel="${paid.tableLabel}". Tela mostra "${pickupLine}" E "Bar do Mestre · Mesa 1" ao mesmo tempo (retirada no balcão × pedido na mesa).`,
  });
  expect(pickupLine).toContain(paid.pickupPoint);
  await page.screenshot({ path: 'e2e/.results/a12-tracking-mesa-vs-retirada.png' });
  await ctx.close();
});
