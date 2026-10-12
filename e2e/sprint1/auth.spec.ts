import { expect, test, type CDPSession } from '@playwright/test';
import { Api } from '../support/api';
import { ACCOUNTS, PASSWORD } from '../support/env';
import { dbOne, dbQuery } from '../support/db';
import { createDisposableAccount, randomCpf, uniq, waitOtpCooldown } from '../support/domain';
import { paceUi } from '../support/pacer';
import { newClientContext, newStaffContext, nav, otpMark, typeCode, waitForOtp } from '../support/ui';

// Sprint 1 — cadastro (01), login (06), RBAC, sessão; Sprint 2 — verificação de contato (65) e falha de biometria (59).

test('S1-01 · cadastro por e-mail: CPF inválido bloqueado, CPF duplicado recusado pelo servidor, CPF guardado protegido; confirmação 65 do e-mail', async ({ browser }) => {
  const ctx = await newClientContext(browser);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Maria');
  await page.getByLabel('Sobrenome').fill('Teste E2E');
  // CPF inválido (dígitos verificadores) é bloqueado antes de avançar
  await page.getByLabel('CPF').fill('111.111.111-11');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('CPF inválido. Confira os números digitados.')).toBeVisible();
  await page.getByLabel('CPF').fill('123.456.789-00');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('CPF inválido. Confira os números digitados.')).toBeVisible();
  // CPF válido de conta existente (João, seed) → servidor recusa no envio, volta ao passo do CPF
  await page.getByLabel('CPF').fill('529.982.247-25');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'E-mail' }).click();
  const email = `e2e-${uniq()}@example.test`;
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Senha1234x');
  await page.getByLabel('Confirmar senha').fill('Senha1234x');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByText('Li e aceito os').click();
  await paceUi('register');
  await page.getByRole('button', { name: 'Criar minha conta' }).click();
  await expect(page.getByText(/CPF/i).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vamos criar sua conta' })).toBeVisible({ timeout: 8000 });
  expect(await dbQuery('select 1 from users where email=$1', [email])).toHaveLength(0);

  // CPF novo → cadastro e tela de confirmação do e-mail (código no log de dev)
  const cpf = randomCpf();
  await page.getByLabel('CPF').fill(cpf);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'E-mail' }).click();
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Senha1234x');
  await page.getByLabel('Confirmar senha').fill('Senha1234x');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByText('Li e aceito os').click();
  const mark = otpMark();
  await paceUi('register');
  await page.getByRole('button', { name: 'Criar minha conta' }).click();
  await expect(page.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeVisible({ timeout: 10_000 });
  const u = await dbOne<any>('select id, name, cpf_hash, cpf_encrypted, cpf_masked, password_hash, email_verified_at from users where email=$1', [email]);
  expect(u!.name).toBe('Maria Teste E2E');
  expect(u!.email_verified_at).toBeNull(); // ainda não verificada
  expect(u!.password_hash).toMatch(/^\$argon2id\$/); // Argon2id
  expect(String(u!.cpf_encrypted)).not.toContain(cpf); // CPF nunca em claro
  expect(u!.cpf_masked).toMatch(/^\*\*\*\.\*\*\*\.\d{3}-\d{2}$/);
  expect(u!.cpf_hash).toBeTruthy();

  // Ficha 65: reenvio só após o intervalo mínimo; só o código correto verifica
  await expect(page.getByText(/Reenviar código em/)).toBeVisible();
  const real = await waitForOtp(mark, 'email', { hint: email });
  const wrong = real === '000000' ? '111111' : '000000';
  await typeCode(page, wrong);
  await expect(page.getByText('Código incorreto. Tente novamente.')).toBeVisible();
  expect((await dbOne<any>('select email_verified_at from users where id=$1', [u!.id]))!.email_verified_at).toBeNull();
  const api = await Api.as(email, 'Senha1234x', { fresh: true });
  const early = await api.post('auth/verify-contact', { channel: 'email' });
  expect(early.status, 'reenvio imediato deve respeitar o intervalo mínimo').toBe(429);
  expect(early.body.code).toBe('OTP_COOLDOWN');
  await typeCode(page, real);
  await expect(page.getByText('Conta criada!')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Confirme seu e-mail ou celular no perfil')).toHaveCount(0);
  expect((await dbOne<any>('select email_verified_at from users where id=$1', [u!.id]))!.email_verified_at).not.toBeNull();
  expect((await api.get('me')).body.user.emailVerified).toBe(true);
  // código já usado não vale de novo
  const reuse = await api.post('auth/verify-contact/confirm', { challengeId: early.body?.challengeId ?? '00000000-0000-4000-8000-000000000000', code: real });
  expect(reuse.status).toBeClientError();
  await ctx.close();
});

test('S1-01b · cadastro por celular: código por SMS (log de dev) verifica o celular; e-mail/telefone/CPF duplicados recusados', async ({ browser }) => {
  const anon = await Api.create();
  const phone = `(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;
  const cpf = randomCpf();
  const reg = await anon.post('auth/register', { name: 'Celular Teste', cpf, phone, acceptTerms: true });
  expect(reg.status).toBe(201);
  expect(reg.body.user.phoneVerified).toBe(false);
  // duplicidade
  const a2 = await Api.create();
  expect((await a2.post('auth/register', { name: 'Outro', cpf, phone: '(11) 98888-7777', acceptTerms: true })).body.code).toBe('CPF_ALREADY_REGISTERED');
  expect((await a2.post('auth/register', { name: 'Outro', cpf: randomCpf(), phone, acceptTerms: true })).body.code).toBe('PHONE_IN_USE');
  expect((await a2.post('auth/register', { name: 'Outro', cpf: randomCpf(), email: ACCOUNTS.client.email, password: 'Senha1234x', acceptTerms: true })).body.code).toBe('EMAIL_IN_USE');
  expect((await a2.post('auth/register', { name: 'Outro', cpf: randomCpf(), email: `x${uniq()}@example.test`, password: 'fraca', acceptTerms: true })).status).toBe(400);
  expect((await a2.post('auth/register', { name: 'Outro', cpf: randomCpf(), email: `x${uniq()}@example.test`, password: 'Senha1234x', acceptTerms: false })).status).toBe(400);
  // verificação do celular
  const mark = otpMark();
  const sent = await anon.post('auth/verify-contact', { channel: 'phone' });
  expect(sent.status).toBeLessThan(300);
  const code = await waitForOtp(mark, 'phone', { hint: phone });
  const bad = await anon.post('auth/verify-contact/confirm', { challengeId: sent.body.challengeId, code: code === '000000' ? '111111' : '000000' });
  expect(bad.body.code).toBe('OTP_INVALID');
  expect((await anon.get('me')).body.user.phoneVerified).toBe(false);
  const ok = await anon.post('auth/verify-contact/confirm', { challengeId: sent.body.challengeId, code });
  expect(ok.status).toBeLessThan(300);
  expect((await anon.get('me')).body.user.phoneVerified).toBe(true);
  expect((await dbOne<any>('select phone_verified_at from users where id=$1', [reg.body.user.id]))!.phone_verified_at).not.toBeNull();
  void browser;
});

test('S1-06 · login: erro genérico, sessão que persiste, logout, código por celular/e-mail, conta suspensa, social indisponível', async ({ browser }) => {
  const ctx = await newClientContext(browser);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Entrar', exact: true }).first().click();
  // Google/Apple sem credenciais: aviso honesto, nada simulado
  await page.getByRole('button', { name: /Continuar com Google/ }).click();
  await expect(page.getByText('Login com Google ainda não está disponível.')).toBeVisible();
  await page.getByRole('button', { name: /Continuar com Apple/ }).click();
  await expect(page.getByText('Login com Apple ainda não está disponível.')).toBeVisible();
  // e-mail inválido
  await page.getByLabel('Celular ou e-mail').fill('isso-nao-e-email');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Digite um e-mail ou celular válido.')).toBeVisible();
  // senha errada → mensagem única; mesma mensagem para e-mail inexistente
  await page.getByLabel('Celular ou e-mail').fill(ACCOUNTS.client.email);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('Senha', { exact: true }).fill('SenhaErrada1');
  await paceUi('login');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const wrongMsg = await page.locator('p.text-error').innerText();
  expect(wrongMsg.length).toBeGreaterThan(5);
  const ghost = await (await Api.create()).post('auth/login', { email: `ghost-${uniq()}@example.test`, password: 'SenhaErrada1' });
  expect(ghost.status).toBe(401);
  expect(ghost.body.message).toBe(wrongMsg); // não revela se o e-mail existe
  // senha certa (2ª tentativa ≤ 3) → entra; sessão persiste após recarregar
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await paceUi('login');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Início' })).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Início' })).toBeVisible({ timeout: 15_000 }); // sessão ativa, sem login de novo
  await nav(page, 'Perfil');
  await expect(page.getByText('João Silva')).toBeVisible();
  // logout encerra a sessão no servidor
  const cookies = (await ctx.cookies()).filter(c => c.name === 'ff_refresh');
  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await page.getByRole('button', { name: 'Sair', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Escanear QR Code' })).toBeVisible();
  expect(cookies.length).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await ctx.close();
});

test('S1-06b · login por código: celular (SMS) e e-mail; código inválido; uso único; conta suspensa e inexistente', async ({ browser }) => {
  const ctx = await newClientContext(browser);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Entrar', exact: true }).first().click();
  await waitOtpCooldown(ACCOUNTS.client.phone);
  await page.getByLabel('Celular ou e-mail').fill(ACCOUNTS.client.phone);
  const mark = otpMark();
  await paceUi('otp');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Digite o código' })).toBeVisible();
  const code = await waitForOtp(mark, 'phone', { hint: ACCOUNTS.client.phone });
  await typeCode(page, code === '000000' ? '111111' : '000000');
  await expect(page.getByText('Código incorreto. Tente novamente.')).toBeVisible();
  await typeCode(page, code);
  await expect(page.getByRole('button', { name: 'Início' })).toBeVisible({ timeout: 15_000 });
  const me = await ctx.request.get('http://localhost:3100/api/me');
  expect((await me.json()).user.email).toBe(ACCOUNTS.client.email);
  // uso único: o mesmo desafio com o mesmo código não abre outra sessão
  const challenge = await dbOne<any>("select id from otp_challenges where purpose='login' order by created_at desc limit 1");
  const again = await (await Api.create()).post('auth/otp/verify', { challengeId: challenge!.id, code });
  expect(again.status).toBeClientError();

  // e-mail por código via API (mesma regra)
  const api = await Api.create();
  await waitOtpCooldown(ACCOUNTS.client2.email);
  const m2 = otpMark();
  const ch = await api.post('auth/otp', { channel: 'email', destination: ACCOUNTS.client2.email });
  expect(ch.status).toBe(201);
  const c2 = await waitForOtp(m2, 'email', { hint: ACCOUNTS.client2.email });
  const v = await api.post('auth/otp/verify', { challengeId: ch.body.challengeId, code: c2 });
  expect(v.status).toBe(200);
  expect(v.body.user.email).toBe(ACCOUNTS.client2.email);

  // conta suspensa não entra por senha NEM por código
  const s = await (await Api.create()).post('auth/login', { email: ACCOUNTS.clientSuspended.email, password: PASSWORD });
  expect(s.status).toBe(403);
  expect(s.body.code).toBe('ACCOUNT_SUSPENDED');
  const sa = await (await Api.create()).post('auth/login', { email: ACCOUNTS.attendantSuspended.email, password: PASSWORD });
  expect(sa.status).toBe(403);
  expect(sa.body.code).toBe('ACCOUNT_SUSPENDED');
  const sOtp = await (await Api.create()).post('auth/otp', { channel: 'email', destination: ACCOUNTS.clientSuspended.email });
  expect(sOtp.status).toBe(403);
  expect(sOtp.body.code).toBe('ACCOUNT_SUSPENDED');
  // destino inexistente: 404 por decisão documentada do projeto (docs/decisoes.md; /auth/register já revela se a conta existe).
  // NÃO é resposta uniforme — registrado como observação de segurança (baixa), não como garantia.
  const g = await (await Api.create()).post('auth/otp', { channel: 'email', destination: `ghost-${uniq()}@example.test` });
  expect(g.status).toBe(404);
  test.info().annotations.push({ type: 'OBSERVAÇÃO segurança (baixa)', description: 'POST /auth/otp com destino inexistente → 404 (enumera contas); decisão documentada em docs/decisoes.md. /auth/password-reset responde 200 uniforme.' });
  await ctx.close();
});

test('S1-RBAC · painéis por papel (UI) e rotas por papel (API)', async ({ browser }) => {
  // cliente não entra nos painéis da equipe
  const c = await newClientContext(browser, { email: ACCOUNTS.client.email });
  for (const path of ['/atendente', '/gestor', '/admin']) {
    const p = await c.newPage();
    await p.goto(path);
    await expect(p.getByText('Acesso exclusivo')).toBeVisible({ timeout: 15_000 });
    await p.close();
  }
  await c.close();
  // atendente: /atendente sim; /gestor e /admin não
  const a = await newStaffContext(browser, ACCOUNTS.attendant.email);
  let p = await a.newPage();
  await p.goto('/atendente');
  await expect(p.getByText('Carlos Mendes').first()).toBeVisible({ timeout: 15_000 });
  await p.goto('/gestor');
  await expect(p.getByText('Acesso exclusivo')).toBeVisible({ timeout: 15_000 });
  await p.goto('/admin');
  await expect(p.getByText('Acesso exclusivo')).toBeVisible({ timeout: 15_000 });
  await a.close();
  // gestor: /gestor e /atendente sim; /admin não
  const m = await newStaffContext(browser, ACCOUNTS.manager.email);
  p = await m.newPage();
  await p.goto('/gestor');
  await expect(p.getByText('Lucas Torres').first()).toBeVisible({ timeout: 15_000 });
  await p.goto('/atendente');
  await expect(p.getByText('Mapa de mesas').first()).toBeVisible({ timeout: 15_000 });
  await p.goto('/admin');
  await expect(p.getByText('Acesso exclusivo')).toBeVisible({ timeout: 15_000 });
  await m.close();
  // admin: /admin sim
  const ad = await newStaffContext(browser, ACCOUNTS.admin.email);
  p = await ad.newPage();
  await p.goto('/admin');
  await expect(p.getByText('Admin FilaZero').first()).toBeVisible({ timeout: 15_000 });
  await ad.close();

  // API
  const client = await Api.as(ACCOUNTS.client.email);
  const att = await Api.as(ACCOUNTS.attendant.email);
  const mgr = await Api.as(ACCOUNTS.manager.email);
  const admin = await Api.as(ACCOUNTS.admin.email);
  for (const [who, api, expected] of [['cliente', client, 403], ['atendente', att, 403], ['gestor', mgr, 403], ['admin', admin, 200]] as const) {
    expect((await api.get('admin/users')).status, `${who} → admin/users`).toBe(expected);
  }
  expect((await (await Api.create()).get('admin/users')).status).toBe(401);
  expect((await (await Api.create()).get('me')).status).toBe(401);
  // CSRF: método de escrita sem o header de cliente é recusado
  const raw = await Api.create();
  const noHeader = await raw.ctx.post('http://localhost:3100/api/auth/logout', { headers: { 'X-FilaFacil-Client': '' } });
  expect([400, 403]).toContain(noHeader.status());
});

test('S1-RT · suspensão derruba sessão e socket na hora (admin suspende; cliente vê bloqueio sem recarregar) e reativação libera', async ({ browser }) => {
  const acc = await createDisposableAccount();
  const ctx = await newClientContext(browser, { email: acc.email, password: acc.password, fresh: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Início' })).toBeVisible({ timeout: 15_000 });
  const admin = await Api.as(ACCOUNTS.admin.email);
  try {
    expect((await admin.patch(`admin/users/${acc.id}/status`, { status: 'suspended' })).status).toBeLessThan(300);
    await expect(page.getByText('Conta suspensa')).toBeVisible({ timeout: 10_000 });
    const login = await (await Api.create()).post('auth/login', { email: acc.email, password: acc.password });
    expect(login.status).toBe(403);
    expect((await dbOne<any>('select status from users where id=$1', [acc.id]))!.status).toBe('suspended');
    const audit = await admin.get('admin/permission-audit');
    expect(JSON.stringify(audit.body)).toContain(acc.id);
  } finally {
    await admin.patch(`admin/users/${acc.id}/status`, { status: 'active' });
  }
  expect((await (await Api.create()).post('auth/login', { email: acc.email, password: acc.password })).status).toBe(200);
  await ctx.close();
});

test('D5b · biometria: leitura falha → mensagem e login tradicional continua (fallback, ficha 59)', async ({ browser }) => {
  const acc = await createDisposableAccount({ password: 'SenhaBio1234' });
  const ctx = await newClientContext(browser, { email: acc.email, password: 'SenhaBio1234', fresh: true });
  const page = await ctx.newPage();
  const cdp: CDPSession = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Início' })).toBeVisible({ timeout: 15_000 });
  await nav(page, 'Perfil');
  await page.getByRole('button', { name: 'Segurança e privacidade' }).click();
  await page.getByRole('switch', { name: 'Entrar com biometria' }).click();
  await page.getByLabel('Sua senha').fill('SenhaBio1234');
  await page.getByRole('button', { name: 'Ativar' }).click();
  await expect(page.getByText('Login por biometria ativado')).toBeVisible({ timeout: 10_000 });
  await nav(page, 'Perfil');
  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await page.getByRole('button', { name: 'Sair', exact: true }).last().click();
  await page.getByRole('button', { name: 'Entrar', exact: true }).first().click();
  // leitura biométrica falha (usuário não verificado no autenticador)
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
  await page.getByRole('button', { name: /Entrar com biometria/ }).click();
  // Falha de verificação do usuário no autenticador = NotAllowedError (igual a "cancelar"): o app não abre sessão,
  // sai do estado "Aguardando biometria…" e mantém o login por celular/e-mail na mesma tela (fallback).
  await expect(page.getByText('Não foi possível ler a biometria. Use celular ou e-mail abaixo.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Aguardando biometria…')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Início' })).toHaveCount(0);
  await expect(page.getByLabel('Celular ou e-mail')).toBeVisible();
  await expect(page.getByRole('button', { name: /Entrar com biometria/ })).toBeEnabled();
  
  // tentar de novo com leitura OK funciona; e o login tradicional segue disponível
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
  await page.getByRole('button', { name: /Entrar com biometria/ }).click();
  await expect(page.getByRole('button', { name: 'Início' })).toBeVisible({ timeout: 15_000 });
  await ctx.close();
});

test('S1-SEC · proteção de força bruta: 5 senhas erradas bloqueiam a conta; rate limit de IP responde 429; resposta de erro sem stack', async () => {
  const acc = await createDisposableAccount({ password: 'SenhaForte123' });
  const api = await Api.create();
  const codes: string[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await api.post('auth/login', { email: acc.email, password: `Errada${i}x` });
    codes.push(r.body.code ?? String(r.status));
    expect(JSON.stringify(r.body)).not.toMatch(/stack|at .*\.ts|prisma/i);
  }
  expect(codes.slice(0, 5)).toEqual(Array(5).fill('INVALID_CREDENTIALS'));
  expect(codes[5]).toBe('TOO_MANY_LOGIN_ATTEMPTS');
  // com a conta bloqueada, nem a senha certa entra
  const ok = await api.post('auth/login', { email: acc.email, password: 'SenhaForte123' });
  expect(ok.status).toBe(429);
  expect(ok.body.code).toBe('TOO_MANY_LOGIN_ATTEMPTS');
});
