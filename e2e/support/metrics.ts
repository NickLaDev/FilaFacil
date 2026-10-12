import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { ROOT } from './env';

const FILE = path.join(ROOT, 'e2e/.results/latency.jsonl');

/** Registra uma latência medida (ms) contra a meta da ficha; vai para o relatório e para e2e/.results/latency.jsonl. */
export function recordMetric(name: string, ms: number, targetMs?: number) {
  mkdirSync(path.dirname(FILE), { recursive: true });
  appendFileSync(FILE, JSON.stringify({ at: new Date().toISOString(), test: test.info().title, name, ms, targetMs: targetMs ?? null, ok: targetMs === undefined ? null : ms <= targetMs }) + '\n');
  test.info().annotations.push({ type: `latência: ${name}`, description: `${ms} ms${targetMs ? ` (meta ${targetMs} ms)` : ''}` });
}

/** Espera `predicate` virar verdadeiro e devolve quanto tempo levou (ms), a partir de `since`. */
export async function elapsedUntil(since: number, predicate: () => Promise<boolean>, timeoutMs = 15_000, intervalMs = 100): Promise<number> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate().catch(() => false)) return Date.now() - since;
    if (Date.now() > end) throw new Error(`timeout (${timeoutMs} ms) esperando condição`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
}
