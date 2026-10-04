import { execFileSync } from 'node:child_process';
import { loadTestEnv } from './load-test-env.js';

/** Aplica as migrations versionadas no banco de teste antes da suíte (mesmo caminho do deploy). */
export default function setup() {
  loadTestEnv();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { stdio: 'inherit', env: process.env });
}
