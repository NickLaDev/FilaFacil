import { request } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { API_URL, CLIENT_HEADER, E2E_DB, PASSWORD, ROOT, WEB_URL } from './env';
import { dbOne } from './db';
import { pace } from './pacer';

/**
 * GUARDA DE ISOLAMENTO: aborta a suíte se o alvo não for a pilha E2E (web :5180 → API :3100 → banco filafacil_e2e).
 * Prova o elo API→banco logando na API e achando a sessão criada dentro do banco filafacil_e2e.
 */
export default async function globalSetup() {
  const fail = (msg: string) => {
    throw new Error(`\n[E2E GUARD] ${msg}\nSuba/verifique a pilha: node scripts/e2e-env.mjs start (ver e2e/README.md)\n`);
  };
  if (!/:3100\/api$/.test(API_URL) || !/:518[01]$/.test(WEB_URL)) fail('URLs de alvo não são 3100/5180|5181');

  const ctx = await request.newContext({ extraHTTPHeaders: CLIENT_HEADER });
  const health = await ctx.get(`${API_URL}/health`).catch(() => null);
  if (!health?.ok()) fail(`API ${API_URL}/health não responde`);
  const webHealth = await ctx.get(`${WEB_URL}/api/health`).catch(() => null);
  if (!webHealth?.ok()) fail(`web ${WEB_URL} não encaminha /api para a API`);

  const providers = await (await ctx.get(`${API_URL}/auth/providers`)).json();
  if (providers.paymentProvider !== 'simulated') fail(`paymentProvider=${providers.paymentProvider}, esperado simulated`);

  // O processo da API em :3100 precisa ser o gravado pelo script E2E.
  const pidsFile = path.join(ROOT, '.e2e/pids.json');
  if (!existsSync(pidsFile)) fail('.e2e/pids.json ausente: a API em :3100 não foi iniciada por scripts/e2e-env.mjs start');
  const { api } = JSON.parse(readFileSync(pidsFile, 'utf8'));
  if (!api) fail('.e2e/pids.json sem PID da API');
  const listening = execFileSync('lsof', ['-ti', 'tcp:3100', '-sTCP:LISTEN']).toString().trim().split('\n');
  if (!listening.includes(String(api))) fail(`PID em :3100 (${listening}) difere do PID E2E (${api})`);

  // Prova API → banco: login real e a sessão aparece no filafacil_e2e.
  const db = await dbOne<{ db: string }>('select current_database() as db');
  if (db?.db !== E2E_DB) fail(`banco conectado: ${db?.db}`);
  let login = await ctx.post(`${API_URL}/auth/login`, { data: { email: 'joao@email.com', password: PASSWORD } });
  for (let i = 0; i < 6 && login.status() === 429; i++) {
    await new Promise(r => setTimeout(r, 15_000)); // limite de login do IP consumido (outros processos); espera, não desliga
    await pace('login');
    login = await ctx.post(`${API_URL}/auth/login`, { data: { email: 'joao@email.com', password: PASSWORD } });
  }
  if (!login.ok()) fail(`login do seed falhou (${login.status()}). Banco E2E semeado? node scripts/e2e-env.mjs db:setup`);
  // A sessão criada por esse login (claim `sid` do JWT) precisa existir no banco filafacil_e2e.
  const cookies = await ctx.storageState();
  const access = cookies.cookies.find(c => c.name === 'ff_access')?.value ?? '';
  const sid = JSON.parse(Buffer.from(access.split('.')[1] ?? 'e30', 'base64url').toString()).sid;
  const found = sid ? await dbOne('select 1 as ok from sessions where id = $1', [sid]) : null;
  if (!found) fail(`a API em :3100 NÃO grava em ${E2E_DB} (sessão ${sid} ausente)`);
  // Os horários do seed (ex.: Bar do Mestre 10:00–02:00) fecham a casa de madrugada e os testes de pedido dependem de
  // "aberto". Setup de dados do E2E (só no banco filafacil_e2e): casas usadas nos pedidos passam a abrir 24 h.
  const admin = await request.newContext({ extraHTTPHeaders: CLIENT_HEADER });
  const al = await admin.post(`${API_URL}/auth/login`, { data: { email: 'admin@filazero.app', password: PASSWORD } });
  if (al.ok()) {
    const hours = [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, opensAt: '00:00', closesAt: '23:59' }));
    for (const n of [1, 4, 5, 7]) {
      const id = `00000001-0000-4000-8000-${String(n).padStart(12, '0')}`;
      await admin.patch(`${API_URL}/admin/establishments/${id}`, { data: { openingHours: hours } });
    }
  } else console.log(`[E2E setup] login admin falhou (${al.status()}); horários não ajustados`);
  await admin.dispose();
  mkdirSync(path.join(ROOT, 'e2e/.results'), { recursive: true });
  writeFileSync(path.join(ROOT, 'e2e/.results/latency.jsonl'), ''); // latências só da execução atual
  await ctx.dispose();
  console.log(`[E2E GUARD] ok · web ${WEB_URL} → API ${API_URL} → banco ${E2E_DB}`);
}
