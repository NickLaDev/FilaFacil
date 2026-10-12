// Ambiente isolado de E2E: banco `filafacil_e2e`, API :3100, web :5180. Não toca no banco de dev nem no .env.
//
// Uso (a partir da raiz):
//   node scripts/e2e-env.mjs db:setup     cria o banco se faltar + migrate deploy + seed (só filafacil_e2e)
//   node scripts/e2e-env.mjs db:reset     GUARDADO: TRUNCATE de tudo em filafacil_e2e + seed
//   node scripts/e2e-env.mjs build        compila a API para node_modules/.e2e-dist (não mexe em apps/api/dist)
//   node scripts/e2e-env.mjs api          sobe a API E2E (foreground; log em .e2e/api.log)
//   node scripts/e2e-env.mjs web          sobe o Vite E2E (foreground; log em .e2e/web.log)
//   node scripts/e2e-env.mjs start        build + sobe API e web em background (PIDs em .e2e/pids.json) e espera ficarem saudáveis
//   node scripts/e2e-env.mjs web:build   gera o build de produção do web em .e2e/web-dist (não mexe em apps/web/dist)
//   node scripts/e2e-env.mjs preview      sobe `vite preview` (build de produção) em :5181 com proxy /api → :3100 (PID em .e2e/pids.preview.json)
//   node scripts/e2e-env.mjs stop         encerra só os PIDs gravados por `start`
//   node scripts/e2e-env.mjs dev-snapshot grava contagens (somente leitura) do banco de dev em .e2e/dev-snapshot.<label>.json
//   node scripts/e2e-env.mjs dev-verify   compara com o snapshot "start"
//   node scripts/e2e-env.mjs otp [mascarado] [sms|email]   último OTP do log da API
//   node scripts/e2e-env.mjs print-env    imprime as variáveis NÃO secretas
// Throttle: `start` = limites REAIS. `E2E_THROTTLE_DISABLED=true node scripts/e2e-env.mjs start` = liga o interruptor existente THROTTLE_DISABLED
// (suítes que não testam rate limit). Para S1-SEC: stop e start SEM a variável (reinicie a API; só a API lê o interruptor).
// Também exporta: e2eEnv(), assertE2eDatabase(url), latestOtp(...).
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const apiDir = path.join(root, 'apps/api');
const webDir = path.join(root, 'apps/web');
const stateDir = path.join(root, '.e2e');
export const E2E_DB = 'filafacil_e2e';
export const API_PORT = 3100;
export const WEB_PORT = 5180;
export const PREVIEW_PORT = 5181; // build de produção servido por `vite preview` (medições de desempenho)
export const API_LOG = path.join(stateDir, 'api.log');
export const WEB_LOG = path.join(stateDir, 'web.log');
const distDir = path.join(apiDir, 'node_modules/.e2e-dist');
const requireFromApi = createRequire(path.join(apiDir, 'package.json'));

function readDotenv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Credenciais do Postgres vêm do .env raiz (somente leitura, nunca impressas). */
function pgBase() {
  const dot = readDotenv(path.join(root, '.env'));
  const url = new URL(dot.DATABASE_URL);
  return { dot, url };
}

export function e2eDatabaseUrl() {
  const { url } = pgBase();
  url.pathname = `/${E2E_DB}`;
  return url.toString();
}

/** Segredos próprios do E2E (derivados; diferentes dos de dev para não misturar sessões/cookies em localhost). */
function derive(label, bytes = 48) {
  const { dot } = pgBase();
  return createHash('sha512').update(`e2e:${label}:${dot.POSTGRES_PASSWORD ?? dot.DATABASE_URL}`).digest('base64url').slice(0, bytes);
}

/** Env completo do E2E. THROTTLE: limites reais ficam LIGADOS; só E2E_THROTTLE_DISABLED=true liga o interruptor THROTTLE_DISABLED. */
export function e2eEnv() {
  const env = {
    NODE_ENV: 'development',
    API_PORT: String(API_PORT),
    WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
    API_PUBLIC_URL: `http://localhost:${WEB_PORT}/api`,
    DATABASE_URL: e2eDatabaseUrl(),
    TEST_DATABASE_URL: '', // nunca herdar
    JWT_ACCESS_SECRET: derive('jwt'),
    CPF_HMAC_SECRET: derive('cpf-hmac'),
    OTP_HMAC_SECRET: derive('otp'),
    CPF_ENCRYPTION_KEY: createHash('sha256').update(`e2e:cpfkey:${derive('cpf-enc')}`).digest('base64'),
    COOKIE_SECURE: 'false',
    ACCESS_TOKEN_TTL_SECONDS: '600',
    REFRESH_TOKEN_TTL_DAYS: '30',
    SMS_PROVIDER: 'dev',
    EMAIL_PROVIDER: 'dev',
    PAYMENT_PROVIDER: 'simulated',
    ALLOW_SIMULATED_PAYMENTS: 'true',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: path.join(stateDir, 'uploads'),
    WEBAUTHN_RP_ID: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    APPLE_CLIENT_ID: '',
    VITE_API_URL: '/api',
    VITE_API_PROXY_TARGET: `http://localhost:${API_PORT}`,
    VITE_MP_PUBLIC_KEY: '',
  };
  if (process.env.E2E_THROTTLE_DISABLED === 'true') env.THROTTLE_DISABLED = 'true';
  return env;
}

const NON_SECRET = ['NODE_ENV', 'API_PORT', 'WEB_ORIGIN', 'API_PUBLIC_URL', 'SMS_PROVIDER', 'EMAIL_PROVIDER', 'PAYMENT_PROVIDER', 'ALLOW_SIMULATED_PAYMENTS', 'VITE_API_URL', 'VITE_API_PROXY_TARGET', 'THROTTLE_DISABLED'];

function pgClient(connectionString) {
  const { Client } = requireFromApi('pg');
  return new Client({ connectionString });
}

/** Conecta e confirma current_database() === 'filafacil_e2e'. Lança antes de qualquer operação destrutiva. */
export async function assertE2eDatabase(url) {
  const client = pgClient(url);
  await client.connect();
  try {
    const { rows } = await client.query('select current_database() as db');
    if (rows[0].db !== E2E_DB) throw new Error(`GUARD: banco conectado é "${rows[0].db}", esperado "${E2E_DB}". Operação destrutiva abortada.`);
  } finally {
    await client.end();
  }
  return true;
}

async function ensureDatabase() {
  const { url } = pgBase();
  url.pathname = '/postgres';
  const admin = pgClient(url.toString());
  await admin.connect();
  try {
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [E2E_DB]);
    if (!rowCount) {
      await admin.query(`create database ${E2E_DB}`);
      console.log(`banco ${E2E_DB} criado`);
    } else console.log(`banco ${E2E_DB} já existe`);
  } finally {
    await admin.end();
  }
}

function run(cmd, args, cwd, env) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} falhou (${r.status})`);
}

async function dbSetup() {
  const env = e2eEnv();
  await ensureDatabase();
  await assertE2eDatabase(env.DATABASE_URL);
  run('node_modules/.bin/prisma', ['migrate', 'deploy'], apiDir, env);
  run('node_modules/.bin/tsx', ['prisma/seed.ts'], apiDir, env);
}

async function dbReset() {
  const env = e2eEnv();
  await assertE2eDatabase(env.DATABASE_URL); // GUARD antes de qualquer truncate
  const client = pgClient(env.DATABASE_URL);
  await client.connect();
  try {
    const { rows } = await client.query("select current_database() as db");
    if (rows[0].db !== E2E_DB) throw new Error('GUARD (2): banco inesperado');
    const t = await client.query("select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations'");
    if (t.rows.length) await client.query(`truncate ${t.rows.map(r => `"${r.tablename}"`).join(', ')} restart identity cascade`);
    console.log(`${t.rows.length} tabelas truncadas em ${E2E_DB}`);
  } finally {
    await client.end();
  }
  run('node_modules/.bin/tsx', ['prisma/seed.ts'], apiDir, env);
}

function build() {
  // Build separado (tsc) para não sobrescrever apps/api/dist, que o `pnpm dev` pode estar usando.
  run('pnpm', ['--filter', '@filafacil/shared', 'build'], root, {});
  run('node_modules/.bin/tsc', ['-p', 'tsconfig.build.json', '--outDir', distDir, '--incremental', 'false'], apiDir, {});
}

const webDist = path.join(stateDir, 'web-dist');
function webBuild() {
  mkdirSync(stateDir, { recursive: true });
  // `vite build` direto (sem `tsc -b`: a checagem de tipos é do `pnpm --filter web build`); mesmas variáveis VITE_* do E2E.
  run('node_modules/.bin/vite', ['build', '--outDir', webDist, '--emptyOutDir'], webDir, e2eEnv());
}
async function preview() {
  if (!existsSync(path.join(webDist, 'index.html'))) webBuild();
  const r = spawnSync('lsof', ['-ti', `tcp:${PREVIEW_PORT}`, '-sTCP:LISTEN']);
  if (r.stdout.toString().trim()) throw new Error(`porta ${PREVIEW_PORT} em uso (PID ${r.stdout.toString().trim()})`);
  const fd = logFd(path.join(stateDir, 'preview.log'));
  const p = spawn('node_modules/.bin/vite', ['preview', '--outDir', webDist, '--port', String(PREVIEW_PORT), '--strictPort', '--host', 'localhost'], { cwd: webDir, env: { ...process.env, ...e2eEnv() }, stdio: ['ignore', fd, fd], detached: true });
  p.unref();
  writeFileSync(path.join(stateDir, 'pids.preview.json'), JSON.stringify({ preview: p.pid }));
  await waitFor(`http://localhost:${PREVIEW_PORT}/`);
  console.log(`vite preview (build de produção) :${PREVIEW_PORT} (pid ${p.pid})`);
}

function logFd(file) {
  mkdirSync(stateDir, { recursive: true });
  return openSync(file, 'a');
}

function spawnApi(detached) {
  const fd = logFd(API_LOG);
  return spawn('node', [path.join(distDir, 'main.js')], { cwd: apiDir, env: { ...process.env, ...e2eEnv() }, stdio: ['ignore', fd, fd], detached });
}
function spawnWeb(detached) {
  const fd = logFd(WEB_LOG);
  return spawn('node_modules/.bin/vite', ['--port', String(WEB_PORT), '--strictPort', '--host', 'localhost'], { cwd: webDir, env: { ...process.env, ...e2eEnv() }, stdio: ['ignore', fd, fd], detached });
}

async function waitFor(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`timeout esperando ${url}`);
}

async function start() {
  if (!existsSync(path.join(distDir, 'main.js'))) build();
  for (const port of [API_PORT, WEB_PORT]) {
    const r = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']);
    if (r.stdout.toString().trim()) throw new Error(`porta ${port} em uso (PID ${r.stdout.toString().trim()}); rode "stop" ou libere.`);
  }
  const api = spawnApi(true);
  const web = spawnWeb(true);
  api.unref();
  web.unref();
  writeFileSync(path.join(stateDir, 'pids.json'), JSON.stringify({ api: api.pid, web: web.pid }));
  await waitFor(`http://localhost:${API_PORT}/api/health`).catch(() => waitFor(`http://localhost:${API_PORT}/api/docs`));
  await waitFor(`http://localhost:${WEB_PORT}/`);
  console.log(`API :${API_PORT} (pid ${api.pid}, log ${API_LOG}) · web :${WEB_PORT} (pid ${web.pid}, log ${WEB_LOG})`);
}

function stop() {
  stopFile(path.join(stateDir, 'pids.preview.json'));
  stopFile(path.join(stateDir, 'pids.json'));
}
function stopFile(file) {
  if (!existsSync(file)) return console.log(`sem PIDs gravados (${path.basename(file)})`);
  const pids = JSON.parse(readFileSync(file, 'utf8'));
  for (const [name, pid] of Object.entries(pids)) {
    try {
      process.kill(-pid, 'SIGTERM'); // grupo (detached)
      console.log(`${name} ${pid} encerrado`);
    } catch {
      try { process.kill(pid, 'SIGTERM'); } catch { console.log(`${name} ${pid} já parado`); }
    }
  }
  writeFileSync(file, '{}');
}

// ─── Verificação somente leitura do banco de dev ────────────────────────────
async function devCounts() {
  const { dot } = pgBase();
  const client = pgClient(dot.DATABASE_URL);
  await client.connect();
  try {
    await client.query('set default_transaction_read_only = on');
    const t = await client.query("select tablename from pg_tables where schemaname='public' order by 1");
    const counts = {};
    for (const { tablename } of t.rows) counts[tablename] = Number((await client.query(`select count(*) c from "${tablename}"`)).rows[0].c);
    const db = (await client.query('select current_database() d')).rows[0].d;
    return { db, counts, checksum: createHash('sha256').update(JSON.stringify(counts)).digest('hex').slice(0, 16) };
  } finally {
    await client.end();
  }
}
async function devSnapshot(label) {
  mkdirSync(stateDir, { recursive: true });
  const snap = await devCounts();
  writeFileSync(path.join(stateDir, `dev-snapshot.${label}.json`), JSON.stringify(snap, null, 1));
  console.log(`snapshot dev "${label}": db=${snap.db} tabelas=${Object.keys(snap.counts).length} checksum=${snap.checksum}`);
}
async function devVerify() {
  const before = JSON.parse(readFileSync(path.join(stateDir, 'dev-snapshot.start.json'), 'utf8'));
  const now = await devCounts();
  const diff = Object.keys(now.counts).filter(k => now.counts[k] !== before.counts[k]);
  console.log(diff.length ? `DEV ALTERADO: ${diff.map(k => `${k} ${before.counts[k]}→${now.counts[k]}`).join(', ')}` : `dev inalterado (checksum ${now.checksum} == ${before.checksum})`);
  process.exitCode = diff.length ? 1 : 0;
}

/** Tamanho atual do log da API (use como `after` para só enxergar códigos pedidos depois deste ponto). */
export function apiLogOffset(logFile = API_LOG) {
  return existsSync(logFile) ? readFileSync(logFile).length : 0;
}

/**
 * OTP de desenvolvimento: lê o log da API ("[SMS dev] → (19) *****-9999: ... é 845085" ou "[E-mail dev] → j***@email.com: ...")
 * e devolve o código mais recente. O log só traz o destino MASCARADO, então `masked` é um trecho dele
 * (ex.: "j***@email.com", "9999"); sem `masked`, vale o último código. `channel`: 'sms' | 'email' | undefined.
 * Mecanismo legítimo do provider `dev`; não há backdoor.
 */
export function latestOtp({ masked, channel, after = 0, logFile = API_LOG } = {}) {
  const text = readFileSync(logFile).subarray(after).toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
  const tag = channel === 'sms' ? '[SMS dev]' : channel === 'email' ? '[E-mail dev]' : null;
  const lines = text.split('\n').filter(l => /\[(SMS|E-mail) dev\]/.test(l) && (!tag || l.includes(tag)) && (!masked || l.includes(masked)));
  for (const line of lines.reverse()) {
    const m = /é (\d{6})\b/.exec(line);
    if (m) return m[1];
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'db:setup') await dbSetup();
    else if (cmd === 'db:reset') await dbReset();
    else if (cmd === 'build') build();
    else if (cmd === 'api') spawnApi(false).on('exit', c => process.exit(c ?? 0));
    else if (cmd === 'web') spawnWeb(false).on('exit', c => process.exit(c ?? 0));
    else if (cmd === 'start') await start();
    else if (cmd === 'web:build') webBuild();
    else if (cmd === 'preview') await preview();
    else if (cmd === 'stop') stop();
    else if (cmd === 'dev-snapshot') await devSnapshot(process.argv[3] ?? 'start');
    else if (cmd === 'dev-verify') await devVerify();
    else if (cmd === 'otp') console.log(latestOtp({ masked: process.argv[3], channel: process.argv[4] }) ?? '');
    else if (cmd === 'print-env') for (const k of NON_SECRET) { const v = e2eEnv()[k]; if (v !== undefined) console.log(`${k}=${v}`); }
    else console.log('comandos: db:setup db:reset build api web start stop dev-snapshot dev-verify print-env');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
