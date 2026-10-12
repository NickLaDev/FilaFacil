import { loadavg, cpus, totalmem, freemem, release, platform } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, WEB_URL } from '../support/env';

export interface Summary {
  n: number;
  min: number;
  median: number;
  p95: number;
  max: number;
  samples: number[];
}

/** Percentil por interpolação "nearest-rank" (p95 de 10 amostras = a maior; por isso usamos N ≥ 10 e mostramos o máximo). */
export function summarize(samples: number[]): Summary {
  const s = [...samples].sort((a, b) => a - b);
  const pick = (p: number) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
  const median = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { n: s.length, min: s[0], median, p95: pick(95), max: s[s.length - 1], samples };
}

export const fmt = (x: Summary) => `n=${x.n} min=${x.min.toFixed(0)} mediana=${x.median.toFixed(0)} p95=${x.p95.toFixed(0)} máx=${x.max.toFixed(0)} ms`;

/** `prod` = build de produção servido por `vite preview` (:5181); `dev` = Vite dev server (:5180). */
export const MODE: 'prod' | 'dev' = /:5181$/.test(WEB_URL) ? 'prod' : 'dev';
/** Só o build de produção é obrigado a cumprir as metas das fichas; o modo dev apenas registra (Vite dev compila sob demanda). */
export const ASSERT = MODE === 'prod' && process.env.PERF_ASSERT !== 'false';
export const RUNS = Number(process.env.PERF_RUNS ?? 12);

export function environment() {
  const c = cpus();
  return {
    at: new Date().toISOString(),
    mode: MODE,
    webUrl: WEB_URL,
    platform: `${platform()} ${release()}`,
    cpu: `${c[0]?.model} x${c.length}`,
    ramGB: Number((totalmem() / 2 ** 30).toFixed(1)),
    freeRamGB: Number((freemem() / 2 ** 30).toFixed(1)),
    loadAvg: loadavg().map(v => Number(v.toFixed(2))),
    node: process.version,
    runs: RUNS,
    // Modo do throttle da API (informado por quem sobe a pilha: E2E_THROTTLE_DISABLED=true ao iniciar API e ao rodar a suíte).
    apiThrottle: process.env.E2E_THROTTLE_DISABLED === 'true' ? 'desligado' : 'real (ligado)',
    caveat: 'Máquina de desenvolvimento (laptop) com o Postgres em Docker, API, web e Chromium no mesmo host: serve de limite SUPERIOR de latência; um servidor dedicado tende a ser mais rápido.',
  };
}

export function writeReport(name: string, data: unknown) {
  const dir = path.join(ROOT, 'e2e/.results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `perf-${MODE}-${name}.json`), JSON.stringify({ environment: environment(), ...(data as object) }, null, 1));
}
