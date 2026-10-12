import { expect, test, type Page, type CDPSession } from '@playwright/test';
import { Api, createOrder, menuItems, payApproved } from '../support/api';
import { ACCOUNTS, PASSWORD, SEED } from '../support/env';
import { dbOne, dbQuery } from '../support/db';
import { Disposable, createDisposableAccount, managerApi, verifyEmail } from '../support/domain';
import { logSince } from '../support/log';
import { elapsedUntil, recordMetric } from '../support/metrics';
import { newClientContext, nav, otpMark, typeCode, waitForOtp } from '../support/ui';
import { paceUi } from '../support/pacer';

// Cenário D — conta do cliente: favoritos (45), categorias (60), recuperação de senha (44), exclusão LGPD (53), biometria WebAuthn (59), verificação (65).

const restaurantsTab = (page: Page) => nav(page, 'Restaurantes');

async function openExplore(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Início' }).waitFor({ timeout: 15_000 });
  await restaurantsTab(page);
  await expect(page.getByText(/estabelecimentos? encontrados?/)).toBeVisible({ timeout: 10_000 });
}

test('D1 · favoritos: ícone na lista e no detalhe, aba Favoritos (≤ 1 s), persistência em outro "aparelho", remover com um toque', async ({ browser }) => {
  const email = ACCOUNTS.client2.email;
  const api = await Api.as(email);
  for (const id of (await api.get('me/favorites/ids')).body.ids as string[]) await api.del(`me/favorites/${id}`);
  const ctxA = await newClientContext(browser, { email });
  const a = await ctxA.newPage();
  await openExplore(a);

  // Lista: ícone de favoritar no card do Bar do Zé
  const zeCard = a.locator('div').filter({ has: a.getByText('Bar do Zé', { exact: true }) }).filter({ has: a.getByRole('button', { name: 'Adicionar aos favoritos', exact: true }) }).last();
  const t0 = Date.now();
  await zeCard.getByRole('button', { name: 'Adicionar aos favoritos', exact: true }).click();
  await a.getByRole('button', { name: /^Favoritos/ }).click();
  await expect(a.getByText('1 favorito', { exact: false })).toBeVisible({ timeout: 5000 });
  await expect(a.getByText('Bar do Zé', { exact: true })).toBeVisible();
  recordMetric('ficha 45: tocar no coração → restaurante aparece em Favoritos', Date.now() - t0, 1000);
  expect(Date.now() - t0).toBeLessThanOrEqual(1000); // meta da ficha 45: 1 s (medido em máquina de desenvolvimento)
  const row = await dbQuery<any>('select f.establishment_id from favorites f join users u on u.id=f.user_id where u.email=$1', [email]);
  expect(row.map(r => r.establishment_id)).toEqual([SEED.barDoZe]);

  // Detalhe: ícone também existe e reflete o estado
  await a.getByText('Bar do Zé', { exact: true }).click();
  await expect(a.getByRole('button', { name: 'Ver cardápio' })).toBeVisible(); // estamos na página de detalhe
  const detailHeart = a.getByRole('button', { name: 'Remover dos favoritos', exact: true });
  await expect(detailHeart).toBeVisible();
  await detailHeart.click(); // desfavoritar PELA tela de detalhe persiste
  await expect(a.getByRole('button', { name: 'Adicionar aos favoritos', exact: true })).toBeVisible();
  await expect.poll(async () => (await dbQuery('select 1 from favorites f join users u on u.id=f.user_id where u.email=$1', [email])).length).toBe(0);
  await a.getByRole('button', { name: 'Adicionar aos favoritos', exact: true }).click(); // e favoritar de novo pelo detalhe
  await expect.poll(async () => (await dbQuery('select 1 from favorites f join users u on u.id=f.user_id where u.email=$1', [email])).length).toBe(1);

  // Outro aparelho (contexto novo, login novo): favorito sincronizado com a conta
  const ctxB = await newClientContext(browser, { email, fresh: true });
  const b = await ctxB.newPage();
  await b.goto('/');
  await b.getByRole('button', { name: 'Início' }).waitFor({ timeout: 15_000 });
  await nav(b, 'Perfil');
  await b.getByRole('button', { name: 'Favoritos' }).click();
  await expect(b.getByText('Bar do Zé', { exact: true })).toBeVisible({ timeout: 8000 });

  // Remover com um toque (no aparelho B) → some também no aparelho A após recarregar
  await b.getByRole('button', { name: 'Remover dos favoritos', exact: true }).first().click();
  await expect(b.getByText('Nenhum favorito ainda')).toBeVisible({ timeout: 5000 });
  expect(await dbQuery('select 1 from favorites f join users u on u.id=f.user_id where u.email=$1', [email])).toHaveLength(0);
  await a.reload();
  await a.getByRole('button', { name: 'Início' }).waitFor({ timeout: 15_000 });
  await nav(a, 'Perfil');
  await a.getByRole('button', { name: 'Favoritos' }).click();
  await expect(a.getByText('Nenhum favorito ainda')).toBeVisible({ timeout: 8000 });

  // Visitante não favorita; API
  const ctxV = await newClientContext(browser);
  const v = await ctxV.newPage();
  await v.goto('/');
  await v.getByRole('button', { name: 'Explorar restaurantes' }).click();
  await v.getByRole('button', { name: 'Restaurantes' }).click();
  await v.getByRole('button', { name: 'Adicionar aos favoritos', exact: true }).first().click();
  await expect(v.getByText('Entre na sua conta para salvar favoritos')).toBeVisible();
  expect((await (await Api.create()).put(`me/favorites/${SEED.mestre}`)).status).toBe(401);
  expect([400, 404]).toContain((await api.put('me/favorites/00000000-0000-4000-8000-0000000000aa')).status);
  expect((await api.put('me/favorites/nao-e-uuid')).status).toBe(400);
  expect((await api.put(`me/favorites/${SEED.mestre}`)).status).toBeLessThan(300);
  expect((await api.put(`me/favorites/${SEED.mestre}`)).status).toBeLessThan(300); // idempotente
  expect(await dbQuery('select 1 from favorites f join users u on u.id=f.user_id where u.email=$1', [email])).toHaveLength(1);
  await api.del(`me/favorites/${SEED.mestre}`);
  await ctxA.close();
  await ctxB.close();
  await ctxV.close();
});

test('D2 · filtro por categoria: seleção múltipla, resultados corretos em ≤ 1 s, sem recarregar a tela', async ({ browser }) => {
  const api = await Api.create();
  const cats = (await api.get('restaurants/categories')).body.categories as string[];
  expect(cats.length).toBeGreaterThan(2);
  const all = (await api.get('restaurants')).body.items as any[];
  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();
  await openExplore(page);
  await page.evaluate(() => ((window as any).__e2eMarker = 'sem-reload'));
  const group = page.getByRole('group', { name: 'Categorias de comida' });
  for (const c of cats) await expect(group.getByRole('button', { name: c, exact: true })).toBeVisible();
  const countText = async () => Number(/(\d+) estabelecimento/.exec(await page.getByText(/estabelecimentos? encontrados?/).innerText())![1]);
  const baseline = await countText();
  expect(baseline).toBe(all.length);

  const expected = (sel: string[]) => all.filter(r => sel.some(c => r.foodCategories.includes(c))).length;

  // 1 categoria
  let t0 = Date.now();
  await group.getByRole('button', { name: 'Hambúrguer', exact: true }).click();
  let ms = await elapsedUntil(t0, async () => (await countText()) === expected(['Hambúrguer']), 5000, 30);
  recordMetric('ficha 60: selecionar 1 categoria → lista filtrada', ms, 1000);
  expect(ms).toBeLessThanOrEqual(1000);
  await expect(group.getByRole('button', { name: 'Hambúrguer', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // várias categorias (OR): Hambúrguer + Japonesa
  t0 = Date.now();
  await group.getByRole('button', { name: 'Japonesa', exact: true }).click();
  ms = await elapsedUntil(t0, async () => (await countText()) === expected(['Hambúrguer', 'Japonesa']), 5000, 30);
  recordMetric('ficha 60: selecionar 2ª categoria (múltipla) → lista filtrada', ms, 1000);
  expect(ms).toBeLessThanOrEqual(1000);
  await expect(page.getByText('Sushi Kazu', { exact: true })).toBeVisible();
  await expect(page.getByText('Lancheria do Zé', { exact: true })).toBeVisible();
  await expect(page.getByText('Boteco da Vila', { exact: true })).toHaveCount(0);
  // API devolve o mesmo conjunto
  const srv = (await api.get('restaurants', { categories: 'Hambúrguer,Japonesa' })).body.items.map((r: any) => r.name).sort();
  test.info().annotations.push({ type: 'API categories=Hambúrguer,Japonesa', description: srv.join(', ') });
  expect(srv.length).toBe(expected(['Hambúrguer', 'Japonesa']));
  // categoria sem resultados cruzados e desmarcar
  await group.getByRole('button', { name: 'Hambúrguer', exact: true }).click();
  await elapsedUntil(Date.now(), async () => (await countText()) === expected(['Japonesa']), 3000, 30);
  await group.getByRole('button', { name: 'Japonesa', exact: true }).click();
  await elapsedUntil(Date.now(), async () => (await countText()) === baseline, 3000, 30);
  expect(await page.evaluate(() => (window as any).__e2eMarker)).toBe('sem-reload');
  // categoria inexistente na API → vazio (não erro)
  const none = await api.get('restaurants', { categories: 'CategoriaQueNaoExiste' });
  expect(none.status).toBe(200);
  expect(none.body.items).toHaveLength(0);
  await ctx.close();
});

test('D3 · recuperação de senha: código por e-mail → nova senha → login imediato; sessões antigas caem; código inválido/reutilizado recusado', async ({ browser }) => {
  const acc: Disposable = await createDisposableAccount({ password: 'SenhaAntiga1' });
  await verifyEmail(acc);
  const oldSession = await Api.as(acc.email, 'SenhaAntiga1', { fresh: true });
  expect((await oldSession.get('me')).status).toBe(200);

  const ctx = await newClientContext(browser);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Entrar', exact: true }).first().click();
  await page.getByLabel('Celular ou e-mail').fill(acc.email);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await page.getByLabel('E-mail da conta').fill(acc.email);
  const mark = otpMark();
  await paceUi('password-reset');
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await expect(page.getByText('O código vale por 10 minutos.')).toBeVisible();
  const code = await waitForOtp(mark, 'email', { hint: acc.email });
  // código errado → continua pedindo; o correto é aceito junto com a nova senha
  const wrong = code === '123456' ? '654321' : '123456';
  await typeCode(page, wrong);
  await page.getByLabel('Nova senha', { exact: true }).fill('SenhaNova123');
  await page.getByLabel('Confirmar senha').fill('SenhaNova123');
  await paceUi('password-reset-confirm');
  await page.getByRole('button', { name: 'Salvar senha' }).click();
  await expect(page.getByText(/Código incorreto ou expirado/)).toBeVisible({ timeout: 8000 });
  expect(await dbOne<any>('select 1 as x from users where email=$1 and password_hash is not null', [acc.email])).toBeTruthy();
  // senha antiga continua valendo enquanto não houver código correto
  expect((await (await Api.create()).post('auth/login', { email: acc.email, password: 'SenhaAntiga1' })).status).toBe(200);
  // código correto (mesmo desafio ainda válido; reenvio devolve o mesmo)
  await typeCode(page, code);
  await page.getByLabel('Nova senha', { exact: true }).fill('SenhaNova123');
  await page.getByLabel('Confirmar senha').fill('SenhaNova123');
  await paceUi('password-reset-confirm');
  await page.getByRole('button', { name: 'Salvar senha' }).click();
  await expect(page.getByText('Senha alterada')).toBeVisible({ timeout: 10_000 });

  // login imediato com a nova senha; antiga recusada; sessão antiga invalidada
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByLabel('Celular ou e-mail').fill(acc.email);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('Senha', { exact: true }).fill('SenhaNova123');
  await paceUi('login');
  const tLogin = Date.now();
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Olá, / })).toBeVisible({ timeout: 15_000 }); // home do cliente logado
  recordMetric('ficha 44: após redefinir, login com nova senha', Date.now() - tLogin);
  const old = await (await Api.create()).post('auth/login', { email: acc.email, password: 'SenhaAntiga1' });
  expect(old.status).toBe(401);
  expect((await oldSession.get('me')).status).toBe(401); // sessões antigas encerradas
  // código de uso único: reutilizar o mesmo código é recusado
  const challenge = await dbOne<any>("select id from otp_challenges where purpose='password_reset' order by created_at desc limit 1");
  const reuse = await (await Api.create()).post('auth/password-reset/confirm', { challengeId: challenge!.id, code, newPassword: 'OutraSenha123' });
  expect(reuse.status).toBeClientError();
  expect((await (await Api.create()).post('auth/login', { email: acc.email, password: 'OutraSenha123' })).status).toBe(401);
  // senha fraca recusada pelo servidor
  const sent = await (await Api.create()).post('auth/password-reset', { channel: 'email', destination: acc.email });
  expect(sent.status).toBe(200);
  const weak = await (await Api.create()).post('auth/password-reset/confirm', { challengeId: sent.body.challengeId, code: '000000', newPassword: '123' });
  expect(weak.status).toBe(400);
  // conta inexistente: mesma resposta (sem enumeração)
  const ghost = await (await Api.create()).post('auth/password-reset', { channel: 'email', destination: `nao-existe-${Date.now()}@example.test` });
  expect(ghost.status).toBe(200);
  expect(Object.keys(ghost.body).sort()).toEqual(Object.keys(sent.body).sort());
  await ctx.close();
});

test('D3b · limite de tentativas do código de recuperação (5) e código reenviado respeita o intervalo', async () => {
  const acc = await createDisposableAccount();
  await verifyEmail(acc);
  const anon = await Api.create();
  const mark = otpMark();
  const sent = await anon.post('auth/password-reset', { channel: 'email', destination: acc.email });
  expect(sent.status).toBe(200);
  const real = await waitForOtp(mark, 'email', { hint: acc.email });
  const wrong = real === '000000' ? '111111' : '000000';
  const codes: string[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await anon.post('auth/password-reset/confirm', { challengeId: sent.body.challengeId, code: wrong, newPassword: 'NovaSenha123' });
    codes.push(r.body?.code ?? String(r.status));
  }
  expect(codes[0]).toBe('OTP_INVALID');
  expect(codes).toContain('OTP_TOO_MANY_ATTEMPTS');
  // com o desafio esgotado, nem o código correto vale
  const late = await anon.post('auth/password-reset/confirm', { challengeId: sent.body.challengeId, code: real, newPassword: 'NovaSenha123' });
  expect(late.status).toBeClientError();
  expect((await anon.post('auth/login', { email: acc.email, password: 'NovaSenha123' })).status).toBe(401);
  // reenvio imediato é barrado pelo intervalo mínimo (42 s)
  // Contrato da API: pedir de novo dentro do intervalo mínimo (42 s) responde 200 UNIFORME (não revela a conta) e NÃO envia novo código.
  const markAgain = otpMark();
  const again = await anon.post('auth/password-reset', { channel: 'email', destination: acc.email });
  expect(again.status).toBe(200);
  await new Promise(r => setTimeout(r, 1500));
  expect(logSince(markAgain).filter(l => l.includes('[E-mail dev]') && l.includes('redefinir')), 'nenhum novo e-mail de recuperação dentro do intervalo').toHaveLength(0);
  // O mesmo vale para o código de acesso (login): aí o intervalo é explícito (429 OTP_COOLDOWN)
  const loginCode = await anon.post('auth/otp', { channel: 'email', destination: acc.email });
  expect(loginCode.status).toBe(201);
  const loginAgain = await anon.post('auth/otp', { channel: 'email', destination: acc.email });
  expect(loginAgain.status).toBe(429);
  expect(loginAgain.body.code).toBe('OTP_COOLDOWN');
});

test('D3c · @slow código de recuperação expira (10 min ≤ 30 min da ficha) e não é mais aceito', async () => {
  test.setTimeout(20 * 60_000);
  const acc = await createDisposableAccount();
  await verifyEmail(acc);
  const anon = await Api.create();
  const mark = otpMark();
  const sent = await anon.post('auth/password-reset', { channel: 'email', destination: acc.email });
  const code = await waitForOtp(mark, 'email', { hint: acc.email });
  const row = await dbOne<any>('select expires_at, created_at from otp_challenges where id=$1', [sent.body.challengeId]);
  const lifeMin = (new Date(row!.expires_at).getTime() - new Date(row!.created_at).getTime()) / 60000;
  expect(lifeMin).toBeLessThanOrEqual(30);
  const waitMs = new Date(row!.expires_at).getTime() - Date.now() + 5000;
  await new Promise(r => setTimeout(r, waitMs));
  const r = await anon.post('auth/password-reset/confirm', { challengeId: sent.body.challengeId, code, newPassword: 'NovaSenha123' });
  expect(r.status).toBeClientError();
  expect((await anon.post('auth/login', { email: acc.email, password: 'NovaSenha123' })).status).toBe(401);
  recordMetric('ficha 44: validade real do código', Math.round(lifeMin * 60_000), 30 * 60_000);
});

test('D4 · exclusão de conta (LGPD): reautenticação, anonimização, e-mail de confirmação, login impossível', async ({ browser }) => {
  const acc = await createDisposableAccount({ password: 'SenhaExcluir1' });
  await verifyEmail(acc);
  const fav = await Api.as(acc.email, 'SenhaExcluir1', { fresh: true });
  await fav.put(`me/favorites/${SEED.mestre}`);
  const ctx = await newClientContext(browser, { email: acc.email, password: 'SenhaExcluir1', fresh: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Início' }).waitFor({ timeout: 15_000 });
  await nav(page, 'Perfil');
  await page.getByRole('button', { name: 'Segurança e privacidade' }).click();
  await page.getByRole('button', { name: 'Excluir minha conta' }).click();
  await expect(page.getByText('Antes de excluir')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled(); // exige o aceite
  await page.getByText('Entendo que a exclusão é definitiva.').click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Confirme que é você')).toBeVisible();
  // senha errada não exclui
  await page.getByLabel('Sua senha').fill('SenhaErrada9');
  await page.getByRole('button', { name: 'Excluir minha conta' }).click();
  await expect(page.getByText('Senha incorreta.')).toBeVisible();
  expect((await dbOne<any>('select deleted_at from users where id=$1', [acc.id]))!.deleted_at).toBeNull();
  // senha certa exclui
  const mark = otpMark();
  await page.getByLabel('Sua senha').fill('SenhaExcluir1');
  await page.getByRole('button', { name: 'Excluir minha conta' }).click();
  await expect(page.getByText('Pedido de exclusão recebido')).toBeVisible({ timeout: 10_000 });

  const u = await dbOne<any>('select name, email, phone, password_hash, cpf_hash, cpf_encrypted, cpf_masked, email_verified_at, deleted_at from users where id=$1', [acc.id]);
  expect(u).toMatchObject({ name: 'Conta excluída', email: null, phone: null, password_hash: null, cpf_hash: null, cpf_encrypted: null, cpf_masked: null, email_verified_at: null });
  expect(u.deleted_at).not.toBeNull();
  expect(await dbQuery('select 1 from favorites where user_id=$1', [acc.id])).toHaveLength(0);
  expect(await dbQuery('select 1 from sessions where user_id=$1 and revoked_at is null', [acc.id])).toHaveLength(0);
  // e-mail de confirmação (provider de dev escreve no log)
  const confirmation = logSince(mark).filter(l => l.includes('[E-mail dev]') && /conta foi exclu[ií]da/.test(l));
  expect(confirmation.length, 'e-mail de confirmação de exclusão no log da API').toBeGreaterThan(0);
  // conta excluída não entra mais; sessão antiga morta; mesmo e-mail/CPF podem ser reutilizados
  const login = await (await Api.create()).post('auth/login', { email: acc.email, password: 'SenhaExcluir1' });
  expect(login.status).toBe(401);
  expect((await fav.get('me')).status).toBe(401);
  const reg = await (await Api.create()).post('auth/register', { name: 'Reuso Pos Exclusao', cpf: acc.cpf, email: acc.email, password: 'SenhaNova123', acceptTerms: true });
  expect(reg.status).toBe(201);
  await ctx.close();
});

test('D4b · exclusão por código (conta sem senha usa código); pedido em andamento bloqueia; conta de equipe não exclui', async ({ browser }) => {
  const acc = await createDisposableAccount();
  await verifyEmail(acc);
  const api = await Api.as(acc.email, acc.password, { fresh: true });
  // pedido pago em andamento bloqueia a exclusão
  const mgr = await managerApi();
  const items = await menuItems(api, SEED.mestre);
  const o = await createOrder(api, { establishmentId: SEED.mestre, items: [{ menuItemId: items[0].id, quantity: 1 }] });
  expect((await payApproved(api, o.body.id, o.body.totalCents)).status).toBeLessThan(300);
  const blockedPw = await api.del('me', { password: acc.password });
  expect(blockedPw.status).toBe(409);
  expect(blockedPw.body.code).toBe('ACTIVE_ORDERS');
  expect((await dbOne<any>('select deleted_at from users where id=$1', [acc.id]))!.deleted_at).toBeNull();
  // entrega o pedido → exclusão liberada, por código
  for (const s of ['preparing', 'ready', 'delivered']) expect((await mgr.patch(`establishments/${SEED.mestre}/orders/${o.body.id}/status`, { status: s })).status).toBe(200);
  const mark = otpMark();
  const req = await api.post('me/delete-account/code', { channel: 'email' });
  expect(req.status).toBeLessThan(300);
  const code = await waitForOtp(mark, 'email', { hint: acc.email });
  const wrong = await api.del('me', { challengeId: req.body.challengeId, code: code === '000000' ? '111111' : '000000' });
  expect(wrong.status).toBeClientError();
  expect((await api.del('me', {})).status).toBeClientError(); // sem reautenticação
  const ok = await api.del('me', { challengeId: req.body.challengeId, code });
  expect(ok.status).toBeLessThan(300);
  expect((await dbOne<any>('select deleted_at, name from users where id=$1', [acc.id]))).toMatchObject({ name: 'Conta excluída' });
  // pedido e pagamento permanecem (registro financeiro), ligados à conta anonimizada
  expect(await dbQuery("select status from payments where order_id=$1", [o.body.id])).toEqual([{ status: 'approved' }]);
  // equipe não se auto-exclui pelo fluxo do cliente
  const staff = await Api.as(ACCOUNTS.attendant.email);
  const st = await staff.del('me', { password: PASSWORD });
  expect(st.status).toBe(403);
  void browser;
});

/** Autenticador de plataforma virtual (CDP). Sem hardware biométrico real: valida o fluxo WebAuthn/servidor. */
async function addVirtualAuthenticator(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return cdp;
}

test('D5 · biometria (WebAuthn, autenticador virtual): senha obrigatória p/ ativar, login ≤ 2 s sem digitar, desativar remove', async ({ browser }) => {
  const acc = await createDisposableAccount({ password: 'SenhaBio1234' });
  await verifyEmail(acc);
  const ctx = await newClientContext(browser, { email: acc.email, password: 'SenhaBio1234', fresh: true });
  const page = await ctx.newPage();
  await addVirtualAuthenticator(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Início' }).waitFor({ timeout: 15_000 });
  await nav(page, 'Perfil');
  await page.getByRole('button', { name: 'Segurança e privacidade' }).click();
  const toggle = page.getByRole('switch', { name: 'Entrar com biometria' });
  await expect(toggle).toBeEnabled();
  // senha errada → não registra
  await toggle.click();
  await page.getByLabel('Sua senha').fill('SenhaErrada1');
  await page.getByRole('button', { name: 'Ativar' }).click();
  await expect(page.locator('p.text-error')).toBeVisible({ timeout: 8000 }); // recusa do servidor (senha errada)
  expect(await dbQuery('select 1 from passkeys where user_id=$1', [acc.id])).toHaveLength(0);
  // senha certa → registra
  await page.getByLabel('Sua senha').fill('SenhaBio1234');
  await page.getByRole('button', { name: 'Ativar' }).click();
  await expect(page.getByText('Login por biometria ativado')).toBeVisible({ timeout: 10_000 });
  expect(await dbQuery('select 1 from passkeys where user_id=$1', [acc.id])).toHaveLength(1);
  await expect(toggle).toBeChecked();

  // sair e entrar só com biometria (sem digitar telefone/e-mail/senha)
  await nav(page, 'Perfil');
  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await page.getByRole('button', { name: 'Sair', exact: true }).last().click();
  await page.getByRole('button', { name: 'Entrar', exact: true }).first().click();
  const bio = page.getByRole('button', { name: /Entrar com biometria/ });
  await expect(bio).toBeVisible();
  const t0 = Date.now();
  await bio.click();
  await expect(page.getByRole('heading', { name: /^Olá, / })).toBeVisible({ timeout: 10_000 });
  const ms = Date.now() - t0;
  recordMetric('ficha 59: biometria → sessão aberta (autenticador virtual)', ms, 2000);
  expect(ms).toBeLessThanOrEqual(2000);
  expect((await dbOne<any>('select last_used_at from passkeys where user_id=$1', [acc.id]))!.last_used_at).not.toBeNull();

  // login tradicional continua; credencial não serve para outra conta
  const other = await createDisposableAccount();
  expect((await (await Api.create()).post('auth/login', { email: acc.email, password: 'SenhaBio1234' })).status).toBe(200);
  const otherApi = await Api.as(other.email, other.password, { fresh: true });
  expect((await otherApi.get('auth/webauthn/credentials')).body).toEqual([]);

  // desativar
  await nav(page, 'Perfil');
  await page.getByRole('button', { name: 'Segurança e privacidade' }).click();
  await toggle.click();
  await expect(page.getByText('Login por biometria desativado')).toBeVisible({ timeout: 8000 });
  expect(await dbQuery('select 1 from passkeys where user_id=$1', [acc.id])).toHaveLength(0);
  await ctx.close();
});
