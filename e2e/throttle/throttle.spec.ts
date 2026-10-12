import { expect, request, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { API_URL, CLIENT_HEADER } from '../support/env';
import { dbOne } from '../support/db';
import { otpMark, waitForOtp } from '../support/otp';
import { randomCpf, uniq } from '../support/domain';

/**
 * Segurança / limites de requisição REAIS (projeto `throttle`; `pnpm e2e:throttle`).
 *
 * Pré-requisito: API em modo throttle REAL (sem E2E_THROTTLE_DISABLED) e NINGUÉM mais usando :3100 durante a execução,
 * porque os limites são por IP e por rota (janela de 60 s, bloqueio de 60 s ao estourar — padrão do @nestjs/throttler).
 *   pnpm e2e:stop; node scripts/e2e-env.mjs start; pnpm e2e:throttle
 * Limites conferidos em apps/api/src/modules/auth/auth.controller.ts (@Throttle):
 *   login 10/min · otp (enviar código) 5/min · otp/verify 10/min · password-reset 5/min · password-reset/confirm 10/min · register 5/min
 * Por conta (login-attempts.service.ts): 5 senhas erradas → 429 TOO_MANY_LOGIN_ATTEMPTS por 15 min (janela em memória).
 * Os testes usam chamadas diretas (sem o `pacer`), com e-mails inexistentes/contas descartáveis `e2e-*@example.test`.
 */

const WINDOW_MS = 60_000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let api: APIRequestContext;
const windowStart: Record<string, number> = {};

const call = async (route: string, data: unknown): Promise<APIResponse> => {
  windowStart[route] ??= Date.now();
  return api.post(`${API_URL}/${route}`, { data, headers: CLIENT_HEADER });
};
const code = async (r: APIResponse) => ((await r.json().catch(() => ({}))) as { code?: string }).code ?? String(r.status());

/** Garante `n` chamadas disponíveis na janela da rota (espera a janela de 60 s anterior terminar se preciso). */
async function freshWindow(route: string) {
  const started = windowStart[route];
  if (started) {
    const wait = started + WINDOW_MS + 1500 - Date.now();
    if (wait > 0) await sleep(wait);
  }
  delete windowStart[route];
}

/** Dispara `payload()` até aparecer o 1º 429; devolve quantas passaram antes e a resposta 429. */
async function untilBlocked(route: string, payload: () => unknown, max: number) {
  let passed = 0;
  for (let i = 0; i < max; i++) {
    const r = await call(route, payload());
    if (r.status() === 429) return { passed, blocked: r };
    passed++;
  }
  throw new Error(`${route}: ${max} chamadas e nenhum 429. A API está em modo throttle real? (E2E_THROTTLE_DISABLED deve estar AUSENTE)`);
}

/** Espera o bloqueio terminar (sondando a cada 2 s) e devolve quantos ms levou desde `since`. */
async function recoversAfter(route: string, payload: () => unknown, since: number, maxMs = 90_000) {
  for (;;) {
    await sleep(2000);
    const r = await call(route, payload());
    if (r.status() !== 429) return { ms: Date.now() - since, status: r.status() };
    if (Date.now() - since > maxMs) throw new Error(`${route}: ainda 429 após ${maxMs} ms`);
  }
}

test.beforeAll(async () => {
  api = await request.newContext();
  // O globalSetup do E2E faz 2 logins reais; deixa a janela de login zerar para contagens exatas.
  await sleep(WINDOW_MS + 2000);
});
test.afterAll(() => api.dispose());

test('T1 · login: 10/min por IP — a 11ª tentativa recebe 429 TOO_MANY_REQUESTS (mesmo com credencial válida) e o bloqueio termina em ~60 s', async () => {
  await freshWindow('auth/login');
  // e-mails diferentes a cada chamada: isola o limite de IP do bloqueio por conta
  const wrong = () => ({ email: `ghost-${uniq()}@example.test`, password: 'SenhaErrada1' });
  const { passed, blocked } = await untilBlocked('auth/login', wrong, 15);
  const startedBlock = Date.now();
  expect(passed, 'exatamente 10 tentativas passam por minuto por IP').toBe(10);
  expect(blocked.status()).toBe(429);
  const body = await blocked.json();
  expect(body.code).toBe('TOO_MANY_REQUESTS');
  expect(JSON.stringify(body)).not.toMatch(/stack|node_modules|\.ts:/);
  expect(Number(blocked.headers()['retry-after']), 'Retry-After informado').toBeGreaterThan(0);
  expect(Number(blocked.headers()['retry-after'])).toBeLessThanOrEqual(61);
  // bloqueado de verdade: credenciais corretas do seed também são recusadas, e nenhuma sessão é criada
  const before = (await dbOne<{ n: string }>("select count(*)::text as n from sessions"))!.n;
  const valid = await call('auth/login', { email: 'joao@email.com', password: 'FilaFacil123' });
  expect(valid.status()).toBe(429);
  expect((await dbOne<{ n: string }>("select count(*)::text as n from sessions"))!.n).toBe(before);
  // recuperação
  const rec = await recoversAfter('auth/login', wrong, startedBlock);
  expect(rec.status).toBe(401); // voltou a responder normalmente (credencial errada)
  expect(rec.ms, 'bloqueio dura ~60 s').toBeGreaterThan(5_000);
  expect(rec.ms).toBeLessThan(75_000);
  test.info().annotations.push({ type: 'recuperação do login', description: `${rec.ms} ms após o 429` });
});

test('T2 · bloqueio por conta: 5 senhas erradas → 429 TOO_MANY_LOGIN_ATTEMPTS; senha certa também bloqueada; outra conta não é afetada; código de acesso (OTP) segue disponível', async () => {
  await freshWindow('auth/login');
  await freshWindow('auth/register');
  const mk = async () => {
    const email = `e2e-${uniq()}@example.test`;
    const r = await call('auth/register', { name: 'Conta Bloqueio', cpf: randomCpf(), email, password: 'SenhaForte123', acceptTerms: true });
    expect(r.status()).toBe(201);
    return email;
  };
  const victim = await mk();
  const other = await mk();
  const results: string[] = [];
  for (let i = 0; i < 6; i++) results.push(await code(await call('auth/login', { email: victim, password: `Errada${i}x` })));
  expect(results).toEqual([...Array(5).fill('INVALID_CREDENTIALS'), 'TOO_MANY_LOGIN_ATTEMPTS']);
  const ok = await call('auth/login', { email: victim, password: 'SenhaForte123' });
  expect(ok.status()).toBe(429);
  expect(await code(ok)).toBe('TOO_MANY_LOGIN_ATTEMPTS');
  // caixa/maiúsculas do e-mail não contornam o bloqueio
  expect(await code(await call('auth/login', { email: victim.toUpperCase(), password: 'SenhaForte123' }))).toBe('TOO_MANY_LOGIN_ATTEMPTS');
  // outra conta no mesmo IP entra normalmente
  const fine = await call('auth/login', { email: other, password: 'SenhaForte123' });
  expect(fine.status()).toBe(200);
  // o bloqueio de 15 min é só do login por senha: o código por e-mail continua (a mensagem do erro orienta isso)
  const mark = otpMark();
  const ch = await call('auth/otp', { channel: 'email', destination: victim });
  expect(ch.status()).toBeLessThan(300);
  const otp = await waitForOtp(mark, 'email', { hint: victim });
  const via = await call('auth/otp/verify', { challengeId: (await ch.json()).challengeId, code: otp });
  expect(via.status()).toBe(200);
  // o bloqueio é por conta em memória (15 min): não esperamos aqui; a expiração é janela fixa no serviço (WINDOW_MS) e está fora do alcance de um E2E de minutos.
  test.info().annotations.push({ type: 'NOT VERIFIED', description: 'fim do bloqueio por conta após 15 min não é esperado em tempo real (só a regra "5 erros → 429" e a persistência do bloqueio)' });
});

test('T2b · senha certa zera a contagem de falhas (4 erradas + 1 certa + 4 erradas não bloqueia)', async () => {
  await freshWindow('auth/login');
  await freshWindow('auth/register');
  const email = `e2e-${uniq()}@example.test`;
  expect((await call('auth/register', { name: 'Conta Reset', cpf: randomCpf(), email, password: 'SenhaForte123', acceptTerms: true })).status()).toBe(201);
  const seq: string[] = [];
  for (let i = 0; i < 4; i++) seq.push(await code(await call('auth/login', { email, password: `Errada${i}x` })));
  expect((await call('auth/login', { email, password: 'SenhaForte123' })).status()).toBe(200);
  for (let i = 0; i < 4; i++) seq.push(await code(await call('auth/login', { email, password: `Errada${i}y` })));
  expect(seq).toEqual(Array(8).fill('INVALID_CREDENTIALS'));
  expect((await call('auth/login', { email, password: 'SenhaForte123' })).status()).toBe(200); // ainda entra
});

test('T3 · enviar código de acesso (/auth/otp): 5/min por IP — 6º recebe 429 e volta depois', async () => {
  await freshWindow('auth/otp');
  const p = () => ({ channel: 'email', destination: `ghost-${uniq()}@example.test` });
  const { passed, blocked } = await untilBlocked('auth/otp', p, 10);
  const t = Date.now();
  expect(passed).toBe(5);
  expect(await code(blocked)).toBe('TOO_MANY_REQUESTS');
  const rec = await recoversAfter('auth/otp', p, t);
  expect(rec.status).not.toBe(429);
  expect(rec.ms).toBeGreaterThan(5_000);
  expect(rec.ms).toBeLessThan(75_000);
});

test('T4 · conferir código (/auth/otp/verify): 10/min por IP — 11ª recebe 429 e volta depois', async () => {
  await freshWindow('auth/otp/verify');
  const p = () => ({ challengeId: crypto.randomUUID(), code: '123456' });
  const { passed, blocked } = await untilBlocked('auth/otp/verify', p, 15);
  const t = Date.now();
  expect(passed).toBe(10);
  expect(await code(blocked)).toBe('TOO_MANY_REQUESTS');
  const rec = await recoversAfter('auth/otp/verify', p, t);
  expect(rec.status).toBe(400); // OTP_INVALID: voltou a validar normalmente
});

test('T5 · recuperação de senha: pedir código 5/min e confirmar 10/min por IP', async () => {
  await freshWindow('auth/password-reset');
  await freshWindow('auth/password-reset/confirm');
  const ask = () => ({ channel: 'email', destination: `ghost-${uniq()}@example.test` });
  const first = await call('auth/password-reset', ask());
  expect(first.status()).toBe(200);
  const { passed, blocked } = await untilBlocked('auth/password-reset', ask, 10);
  const t = Date.now();
  expect(passed + 1, '5 pedidos por minuto').toBe(5);
  expect(await code(blocked)).toBe('TOO_MANY_REQUESTS');

  const confirm = () => ({ challengeId: crypto.randomUUID(), code: '123456', newPassword: 'NovaSenha123' });
  const c = await untilBlocked('auth/password-reset/confirm', confirm, 15);
  expect(c.passed).toBe(10);
  expect(await code(c.blocked)).toBe('TOO_MANY_REQUESTS');
  const rec = await recoversAfter('auth/password-reset', ask, t);
  expect(rec.status).toBe(200);
});

test('T6 · cadastro (/auth/register): 5/min por IP — 6º recebe 429 mesmo com dados inválidos; nada é gravado', async () => {
  await freshWindow('auth/register');
  const email = () => `e2e-${uniq()}@example.test`;
  const bad = () => ({ name: 'X', cpf: '00000000000', email: email(), password: 'fraca', acceptTerms: false });
  const { passed, blocked } = await untilBlocked('auth/register', bad, 10);
  expect(passed).toBe(5);
  expect(await code(blocked)).toBe('TOO_MANY_REQUESTS');
  const n = await dbOne<{ n: string }>("select count(*)::text as n from users where email like 'e2e-%@example.test' and created_at > now() - interval '5 seconds'");
  expect(Number(n!.n)).toBe(0);
  // com o limite estourado, até um cadastro VÁLIDO é recusado (não vira bypass)
  const email2 = email();
  const valid = await call('auth/register', { name: 'Valido Teste', cpf: randomCpf(), email: email2, password: 'SenhaForte123', acceptTerms: true });
  expect(valid.status()).toBe(429);
  expect(await dbOne('select 1 as x from users where email=$1', [email2])).toBeUndefined();
});
