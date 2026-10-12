import { defineConfig, devices } from '@playwright/test';

/**
 * Suíte E2E do FilaFacil. Alvo ÚNICO e isolado: web :5180 → API :3100 → banco `filafacil_e2e`.
 * O globalSetup aborta se o alvo não for essa pilha (nunca usa :3000/:5173 nem o banco `filafacil`).
 * Os testes compartilham o estado do banco, então rodam em série (1 worker).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  // perf/ e throttle/ têm projetos próprios (precisam de pilha diferente: build de produção; API com limites REAIS).
  globalSetup: './e2e/support/global-setup.ts',
  outputDir: './e2e/.results/artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  // Um relatório por execução (PW_RUN = chromium|slow|perf|throttle) para que a execução principal não seja sobrescrita pelas demais.
  reporter: [['list'], ['html', { outputFolder: `e2e/.results/report-${process.env.PW_RUN ?? 'chromium'}`, open: 'never' }], ['json', { outputFile: `e2e/.results/results-${process.env.PW_RUN ?? 'chromium'}.json` }]],
  use: {
    baseURL: 'http://localhost:5180',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  projects: [
    // Telas da equipe e do gestor em desktop; as do cliente criam contexto móvel (390×844) pelos helpers.
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }, grepInvert: /@slow/, testIgnore: /e2e\/(perf|throttle)\// },
    // Testes que precisam esperar tempo real (ex.: expiração de código de 10 min). Rodar com `pnpm e2e:slow`.
    { name: 'slow', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }, grep: /@slow/, timeout: 20 * 60_000, testIgnore: /e2e\/(perf|throttle)\// },
    // Desempenho das fichas 11 e 02 (`pnpm e2e:perf`): exige build de produção em :5181 (`node scripts/e2e-env.mjs preview`).
    { name: 'perf', testDir: './e2e/perf', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } }, timeout: 10 * 60_000 },
    // Limites de requisição REAIS (`pnpm e2e:throttle`): exige API em modo throttle real e ninguém mais em :3100.
    { name: 'throttle', testDir: './e2e/throttle', use: { ...devices['Desktop Chrome'] }, timeout: 10 * 60_000 },
  ],
});
