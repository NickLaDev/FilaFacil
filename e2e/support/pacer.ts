import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './env';

/**
 * Os limites de requisição da API ficam LIGADOS durante o E2E (não são enfraquecidos). Para não estourá-los sem querer,
 * as chamadas de autenticação são espaçadas: no máximo (limite - 1) por janela de 60 s, controladas em arquivo
 * (sobrevive a troca de worker). Os testes que PROVAM o rate limit usam chamadas diretas, sem o pacer.
 */
const LIMITS: Record<string, number> = { login: 10, register: 5, otp: 5, 'otp-verify': 10, 'password-reset': 5, 'password-reset-confirm': 10, 'verify-contact': 5, 'verify-contact-confirm': 10, refresh: 30 };
const FILE = path.join(ROOT, '.e2e/.pacer.json');
const WINDOW = 60_000;

export function bucketFor(apiPath: string): string | null {
  const p = apiPath.replace(/^\/?(api\/)?/, '');
  const map: [RegExp, string][] = [
    [/^auth\/login$/, 'login'],
    [/^auth\/register$/, 'register'],
    [/^auth\/otp$/, 'otp'],
    [/^auth\/otp\/verify$/, 'otp-verify'],
    [/^auth\/password-reset$/, 'password-reset'],
    [/^auth\/password-reset\/confirm$/, 'password-reset-confirm'],
    [/^auth\/verify-contact$/, 'verify-contact'],
    [/^auth\/verify-contact\/confirm$/, 'verify-contact-confirm'],
  ];
  return map.find(([re]) => re.test(p))?.[1] ?? null;
}

function load(): Record<string, number[]> {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
  } catch {
    return {};
  }
}

export async function pace(bucket: string) {
  if (process.env.E2E_THROTTLE_DISABLED === 'true') return; // API iniciada com o interruptor de throttle desligado (modo documentado)
  const limit = (LIMITS[bucket] ?? 5) - 1;
  for (;;) {
    const now = Date.now();
    const state = load();
    const recent = (state[bucket] ?? []).filter(t => now - t < WINDOW);
    if (recent.length < limit) {
      state[bucket] = [...recent, now];
      mkdirSync(path.dirname(FILE), { recursive: true });
      writeFileSync(FILE, JSON.stringify(state));
      return;
    }
    await new Promise(r => setTimeout(r, Math.max(300, WINDOW - (now - recent[0]) + 250)));
  }
}

/** Espaça uma ação de UI que dispara um endpoint limitado (ex.: clicar "Entrar"). */
export const paceUi = (bucket: keyof typeof LIMITS) => pace(bucket as string);
