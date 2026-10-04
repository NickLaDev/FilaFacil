import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Ambiente de teste: mesmo .env da raiz, mas apontando para o banco filafacil_test. */
export function loadTestEnv() {
  // O globalSetup e os workers chamam esta função; a troca de banco acontece uma vez só.
  if (process.env.FILAFACIL_TEST_ENV === 'loaded') return;
  const path = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('Defina TEST_DATABASE_URL no .env (veja .env.example).');
  if (testUrl === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL não pode ser o banco de desenvolvimento.');
  process.env.DATABASE_URL = testUrl;
  process.env.NODE_ENV = 'test';
  process.env.THROTTLE_DISABLED = 'true';
  process.env.SMS_PROVIDER = 'dev';
  process.env.EMAIL_PROVIDER = 'dev';
  process.env.GOOGLE_CLIENT_ID = '';
  process.env.GOOGLE_CLIENT_SECRET = '';
  process.env.APPLE_CLIENT_ID = '';
  process.env.STORAGE_LOCAL_DIR = 'storage/test-uploads';
  process.env.FILAFACIL_TEST_ENV = 'loaded';
}
