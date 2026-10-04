// Cria o .env local a partir do .env.example, gerando senhas e segredos aleatórios.
// Uso: pnpm setup:env [--force]
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = `${root}.env`;

if (existsSync(target) && !process.argv.includes('--force')) {
  console.error('.env já existe. Use --force para recriar (senhas e segredos atuais serão substituídos).');
  process.exit(1);
}

const password = randomBytes(18).toString('base64url');
const content = readFileSync(`${root}.env.example`, 'utf8')
  .replaceAll('__GENERATE_PASSWORD__', password)
  .replaceAll('__POSTGRES_PASSWORD__', password)
  .replaceAll('__GENERATE_KEY32__', () => randomBytes(32).toString('base64'))
  .replaceAll('__GENERATE_SECRET__', () => randomBytes(48).toString('base64url'));

writeFileSync(target, content, { mode: 0o600 });
console.log('.env criado com segredos aleatórios.');
