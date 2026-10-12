// Garante a pilha E2E (web :5180 → API :3100 → banco filafacil_e2e). Usa os comandos de scripts/e2e-env.mjs.
// Uso: node e2e/scripts/ensure-stack.mjs [--reset]   (--reset zera o banco filafacil_e2e e refaz o seed antes)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = path.join(root, 'scripts/e2e-env.mjs');
const run = (...args) => {
  const r = spawnSync('node', [env, ...args], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const up = async url => {
  try {
    return (await fetch(url)).status < 500;
  } catch {
    return false;
  }
};

const reset = process.argv.includes('--reset');
const apiUp = await up('http://localhost:3100/api/health');
const webUp = await up('http://localhost:5180/');
if (reset) {
  console.log('[e2e] zerando filafacil_e2e (TRUNCATE guardado) e refazendo o seed…');
  run('db:reset');
} else if (!apiUp || !webUp) {
  run('db:setup');
}
if (!apiUp || !webUp) run('start');
else console.log('[e2e] pilha E2E já está no ar (API :3100, web :5180).');
