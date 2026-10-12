import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { Api } from '../support/api';
import { ACCOUNTS, SEED, WEB_URL } from '../support/env';
import { dbOne, dbQuery } from '../support/db';
import { createDisposableAccount, managerApi, randomCpf, uniq } from '../support/domain';
import { otpMark, waitForOtp } from '../support/otp';
import { MOBILE, newStaffContext, nav, typeCode } from '../support/ui';
import { recordMetric } from '../support/metrics';

// Cenário F — correções de segurança e regressões (fichas 59, 36, 12/13). Real: front + API + PostgreSQL + Socket.IO.

async function addVirtualAuthenticator(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return cdp;
}

/** Conta só com celular (sem senha), sessão aberta no contexto do navegador. */
async function passwordlessPhoneAccount() {
  const api = await Api.create();
  const phone = `(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;
  const reg = await api.post('auth/register', { name: 'Sem Senha E2E', cpf: randomCpf(), phone, acceptTerms: true });
  expect(reg.status).toBe(201);
  return { api, phone, id: reg.body.user.id as string };
}

test('F1 · biometria em conta SEM senha: exige código de contato verificado (REAUTH_REQUIRED sem ele), código errado não registra, código certo registra e o login por biometria funciona (≤ 2 s)', async ({ browser }) => {
  const acc = await passwordlessPhoneAccount();
  // sem contato verificado: nem o código nem as opções de registro são liberados
  const early = await acc.api.post('auth/webauthn/register/code', { channel: 'phone' });
  expect(early.status, JSON.stringify(early.body)).toBeClientError();
  const noCode = await acc.api.post('auth/webauthn/register/options', {});
  expect(noCode.status).toBe(400);
  expect(noCode.body.code).toBe('REAUTH_REQUIRED');
  expect(await dbQuery('select 1 from passkeys where user_id=$1', [acc.id])).toHaveLength(0);
  // verifica o celular pelo fluxo real (SMS simulado no log da API)
  const mark = otpMark();
  const sent = await acc.api.post('auth/verify-contact', { channel: 'phone' });
  expect(sent.status).toBeLessThan(300);
  const vcode = await waitForOtp(mark, 'phone', { hint: acc.phone });
  expect((await acc.api.post('auth/verify-contact/confirm', { challengeId: sent.body.challengeId, code: vcode })).status).toBeLessThan(300);
  // canal que a conta não tem (e-mail) continua recusado
  expect((await acc.api.post('auth/webauthn/register/code', { channel: 'email' })).status).toBeClientError();

  const ctx = await browser.newContext({ viewport: MOBILE, locale: 'pt-BR', baseURL: WEB_URL });
  await ctx.addCookies((await acc.api.ctx.storageState()).cookies);
  const page = await ctx.newPage();
  await addVirtualAuthenticator(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Início' }).waitFor({ timeout: 15_000 });
  await nav(page, 'Perfil');
  await page.getByRole('button', { name: 'Segurança e privacidade' }).click();
  const toggle = page.getByRole('switch', { name: 'Entrar com biometria' });
  await expect(toggle).toBeEnabled();
  const markCode = otpMark();
  const regCode = page.waitForResponse(r => r.url().endsWith('/auth/webauthn/register/code') && r.request().method() === 'POST');
  await toggle.click(); // UI pede o código (não há senha)
  const regChallengeId: string = (await (await regCode).json()).challengeId;
  await expect(page.getByLabel('Sua senha')).toHaveCount(0);
  await expect(page.getByLabel('Dígito 1')).toBeVisible();
  const real = await waitForOtp(markCode, 'phone', { hint: acc.phone });
  await typeCode(page, real === '000000' ? '111111' : '000000'); // errado
  await expect(page.getByText(/incorreto|inválido/i).first()).toBeVisible({ timeout: 8000 });
  expect(await dbQuery('select 1 from passkeys where user_id=$1', [acc.id])).toHaveLength(0);
  await typeCode(page, real);
  await expect(page.getByText('Login por biometria ativado')).toBeVisible({ timeout: 10_000 });
  expect(await dbQuery('select 1 from passkeys where user_id=$1', [acc.id])).toHaveLength(1);
  expect((await dbOne<any>("select consumed_at from otp_challenges where destination=$1 and purpose='passkey_registration' order by created_at desc limit 1", [acc.phone.replace(/\D/g, '')]))!.consumed_at, 'código de uso único consumido').not.toBeNull();
  // o mesmo código não registra de novo (uso único)
  const again = await acc.api.post('auth/webauthn/register/options', { challengeId: regChallengeId, code: real });
  expect(again.status).toBe(400);
  expect(again.body.code).toBe('OTP_INVALID');

  // sair e entrar só com biometria
  await nav(page, 'Perfil');
  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await page.getByRole('button', { name: 'Sair', exact: true }).last().click();
  await page.getByRole('button', { name: 'Entrar', exact: true }).first().click();
  const t0 = Date.now();
  await page.getByRole('button', { name: /Entrar com biometria/ }).click();
  await expect(page.getByRole('heading', { name: /^Olá, / })).toBeVisible({ timeout: 10_000 });
  const ms = Date.now() - t0;
  recordMetric('ficha 59: biometria em conta sem senha → sessão aberta', ms, 2000);
  expect(ms).toBeLessThanOrEqual(2000);
  await ctx.close();
});

test('F2 · ficha 36 em tempo real: atendente que perde as permissões (ou é suspenso) PARA de receber atualizações e perde o acesso à API; o colega com permissão segue recebendo', async ({ browser }) => {
  const E = SEED.mestre;
  const admin = await Api.as(ACCOUNTS.admin.email);
  const mgr = await managerApi();
  // atendente descartável (cliente promovido pelo admin) — não mexe nas contas do seed
  const acc = await createDisposableAccount({ password: 'SenhaStaff123', name: 'Atendente Temporario' });
  const give = await admin.patch(`admin/users/${acc.id}/access`, { role: 'attendant', permissions: ['tables.view', 'menu.availability', 'orders.manage'], establishmentIds: [E] });
  expect(give.status, JSON.stringify(give.body)).toBeLessThan(300);

  const tempCtx = await newStaffContext(browser, acc.email, 'SenhaStaff123', true);
  const temp = await tempCtx.newPage();
  const ctrlCtx = await newStaffContext(browser, ACCOUNTS.attendant.email);
  const ctrl = await ctrlCtx.newPage();
  await temp.goto('/atendente');
  await ctrl.goto('/atendente');
  const node = (p: Page, label: string, status: string) => p.getByRole('button', { name: `${label}: ${status}` });
  const target = (await mgr.get(`establishments/${E}/table-map`)).body.tables.find((t: any) => t.label === 'Mesa 9');
  await mgr.post(`establishments/${E}/tables/${target.id}/release`);
  await expect(node(temp, 'Mesa 9', 'Livre')).toBeVisible({ timeout: 15_000 });
  await expect(node(ctrl, 'Mesa 9', 'Livre')).toBeVisible({ timeout: 15_000 });
  const tableApiTemp = await Api.as(acc.email, 'SenhaStaff123', { fresh: true });
  try {
    // controle positivo: com a permissão, o evento chega às duas telas
    await mgr.post(`establishments/${E}/tables/${target.id}/occupy`, { partySize: 2 });
    await expect(node(temp, 'Mesa 9', 'Ocupada')).toBeVisible({ timeout: 5000 });
    await expect(node(ctrl, 'Mesa 9', 'Ocupada')).toBeVisible({ timeout: 5000 });
    expect((await tableApiTemp.get(`establishments/${E}/table-map`)).status).toBe(200);

    // admin remove TODAS as permissões: sockets saem das salas da equipe e a API recusa
    const revoke = await admin.patch(`admin/users/${acc.id}/access`, { role: 'attendant', permissions: [], establishmentIds: [E] });
    expect(revoke.status, JSON.stringify(revoke.body)).toBeLessThan(300);
    expect((await tableApiTemp.get(`establishments/${E}/table-map`)).status, 'API: sem permissão').toBe(403);
    await mgr.post(`establishments/${E}/tables/${target.id}/release`);
    await expect(node(ctrl, 'Mesa 9', 'Livre')).toBeVisible({ timeout: 5000 }); // quem tem permissão recebe
    // quem perdeu NÃO recebe o mesmo evento (mesmo evento já entregue ao controle; janela curta e limitada para o negativo)
    // janela de observação de 2,5 s: a tela sem permissão NUNCA mostra o novo estado (o controle já o recebeu)
    for (const until = Date.now() + 2500; Date.now() < until; ) {
      expect(await node(temp, 'Mesa 9', 'Livre').count(), 'tela sem permissão não pode receber o evento').toBe(0);
      await temp.waitForTimeout(100);
    }
    await expect(node(temp, 'Mesa 9', 'Ocupada')).toHaveCount(1);

    // restaura permissões e depois SUSPENDE: sessão cai e a tela mostra bloqueio sem recarregar
    expect((await admin.patch(`admin/users/${acc.id}/access`, { role: 'attendant', permissions: ['tables.view'], establishmentIds: [E] })).status).toBeLessThan(300);
    expect((await admin.patch(`admin/users/${acc.id}/status`, { status: 'suspended' })).status).toBeLessThan(300);
    await expect(temp.getByText('Acesso suspenso')).toBeVisible({ timeout: 10_000 });
    expect((await tableApiTemp.get(`establishments/${E}/table-map`)).status).toBeGreaterThanOrEqual(401);
    const audit = JSON.stringify((await admin.get('admin/permission-audit')).body);
    expect(audit).toContain(acc.id);
    for (const action of ['permissions_changed', 'suspended']) expect(audit).toContain(action);
  } finally {
    await mgr.post(`establishments/${E}/tables/${target.id}/release`);
    await admin.patch(`admin/users/${acc.id}/status`, { status: 'suspended' }); // conta descartável fica suspensa
    await tempCtx.close();
    await ctrlCtx.close();
  }
});

test('F3 · ficha 13: "Minhas reservas" no perfil lista a reserva ativa (posição, pessoas) e leva ao restaurante; some ao cancelar', async ({ browser }) => {
  const E = SEED.mestre;
  const mgr = await managerApi();
  for (const e of (await mgr.get(`establishments/${E}/waitlist`)).body.entries as any[]) await mgr.del(`establishments/${E}/waitlist/${e.id}`);
  const acc = await createDisposableAccount({ password: 'SenhaRes1234', name: 'Cliente Reserva E2E' });
  const api = await Api.as(acc.email, acc.password, { fresh: true });
  const ctx = await browser.newContext({ viewport: MOBILE, locale: 'pt-BR', baseURL: WEB_URL });
  await ctx.addCookies((await api.ctx.storageState()).cookies);
  const page = await ctx.newPage();
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Início' }).waitFor({ timeout: 15_000 });
    await nav(page, 'Perfil');
    await page.getByRole('button', { name: 'Minhas reservas' }).click();
    await expect(page.getByText(/Você não tem reservas ativas/)).toBeVisible();
    expect((await api.get('me/reservations')).body.items).toEqual([]);
    const r = await api.post(`restaurants/${E}/reservation`, { partySize: 3, phone: '(19) 98123-4567' });
    expect(r.status).toBe(201);
    // reserva criada por OUTRO canal (ex.: outro aparelho): a lista é reconsultada ao reabrir o app
    await page.reload();
    await page.getByRole('button', { name: 'Início' }).waitFor({ timeout: 15_000 });
    await nav(page, 'Perfil');
    await page.getByRole('button', { name: 'Minhas reservas' }).click();
    const card = page.getByRole('button', { name: /Bar do Mestre/ }).first();
    await expect(card).toContainText('Posição 1 na fila');
    await expect(card).toContainText('3 pessoas');
    const list = (await api.get('me/reservations')).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ restaurantId: E, partySize: 3, position: 1 });
    // outro cliente não vê esta reserva (isolamento)
    const other = await Api.as(ACCOUNTS.client.email);
    expect(((await other.get('me/reservations')).body.items as any[]).some(i => i.id === r.body.id)).toBe(false);
    expect((await (await Api.create()).get('me/reservations')).status).toBe(401);
    await card.click(); // abre a página do restaurante
    await expect(page.getByRole('button', { name: /Sua reserva · posição 1/ })).toBeVisible();
    await api.del(`restaurants/${E}/reservation`);
    expect((await api.get('me/reservations')).body.items).toEqual([]);
  } finally {
    await api.del(`restaurants/${E}/reservation`);
    await ctx.close();
  }
  void uniq;
});
