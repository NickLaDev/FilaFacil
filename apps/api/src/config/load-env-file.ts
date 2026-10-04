import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Carrega o .env da raiz do monorepo quando existir (em produção as variáveis vêm do ambiente). */
export function loadRootEnvFile() {
  const path = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}
