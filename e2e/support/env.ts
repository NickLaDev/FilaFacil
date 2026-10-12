import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Alvo isolado do E2E. Nada aqui aponta para 3000/5173 nem para o banco de desenvolvimento. */
export const ROOT = path.resolve(__dirname, '../..');
/** Web do E2E: dev server :5180 (padrão) ou build de produção servido por `vite preview` em :5181 (projeto `perf`). */
export const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5180';
export const API_URL = 'http://localhost:3100/api';
export const API_VIA_WEB = `${WEB_URL}/api`;
export const E2E_DB = 'filafacil_e2e';
export const API_LOG = path.join(ROOT, '.e2e/api.log');
export const PASSWORD = 'FilaFacil123';
export const CLIENT_HEADER = { 'X-FilaFacil-Client': 'web' };

export function readDotenv(file = path.join(ROOT, '.env')): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Mesma URL do Postgres local do .env, só que apontando para o banco do E2E (credenciais não são impressas). */
export function e2eDatabaseUrl(): string {
  const url = new URL(readDotenv().DATABASE_URL);
  url.pathname = `/${E2E_DB}`;
  return url.toString();
}

/** Contas do seed (README). */
export const ACCOUNTS = {
  admin: { email: 'admin@filazero.app', role: 'admin' },
  manager: { email: 'lucas@bardomestre.com.br', role: 'manager' },
  managerStart: { email: 'paula@cantina.edu.br', role: 'manager' },
  managerPro: { email: 'ze@grupodoze.com.br', role: 'manager' },
  attendant: { email: 'carlos@bardomestre.com.br', role: 'attendant' },
  attendantSuspended: { email: 'mariana@bardomestre.com.br', role: 'attendant' },
  client: { email: 'joao@email.com', role: 'client', phone: '(19) 99999-9999' },
  client2: { email: 'marina.s@gmail.com', role: 'client', phone: '(19) 98765-4321' },
  clientNoPhone: { email: 'pedro.c@hotmail.com', role: 'client' },
  clientSuspended: { email: 'joana.f@gmail.com', role: 'client' },
} as const;

/** IDs fixos do seed. */
const id = (ns: number, n: number) => `${String(ns).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const SEED = {
  est: (n: number) => id(1, n),
  table: (n: number) => id(2, n),
  item: (n: number) => id(6, n),
  user: (n: number) => id(5, n),
  mestre: id(1, 1),
  mestre2: id(1, 7),
  express: id(1, 8),
  cantina: id(1, 3),
  barDoZe: id(1, 6),
  lancheria: id(1, 5),
};
/** Mesas do Bar do Mestre no seed: 1 livre (QR MESTRE-1041) ... ver prisma/seed.ts. */
export const QR = { mesa1: 'MESTRE-1041', mesa5: 'MESTRE-5379', mesa8: 'MESTRE-8664', mesa10: 'MESTRE-1095', mesa2Ocupada: 'MESTRE-2087', express1: 'EXPRESS-1150' };
