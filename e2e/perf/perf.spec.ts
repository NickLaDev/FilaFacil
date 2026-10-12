import { expect, test, type BrowserContext, type Browser, type Page } from '@playwright/test';
import { Api } from '../support/api';
import { ACCOUNTS, PASSWORD, QR, SEED, WEB_URL } from '../support/env';
import { loginContext } from '../support/api';
import { MOBILE } from '../support/ui';
import { ASSERT, MODE, RUNS, fmt, summarize, writeReport, environment } from './stats';

/**
 * Desempenho das fichas 11 e 02 (meta do PDF).
 *   ficha 11 (Sprint 1): "A busca retorna estabelecimentos ordenados por distância em até 2 segundos, com status de 'aceitando pedidos' visível."
 *   ficha 02 (Sprint 2): "Ao escanear, o cliente cai no cardápio da mesa certa em até 3 segundos, com o pedido já associado à mesa."
 *
 * Como rodar (build de produção, o que vale para a meta):
 *   node scripts/e2e-env.mjs web:build && node scripts/e2e-env.mjs preview   # :5181
 *   pnpm e2e:perf                                                              # RUNS=12 por padrão (PERF_RUNS=N)
 * No Vite dev server (:5180) o spec roda e REGISTRA, mas não reprova (o dev server compila módulos sob demanda).
 * "Frio" = contexto de navegador novo (cache HTTP/JS vazio). "Quente" = mesma página/contexto, bundle em cache.
 * Resultados: e2e/.results/perf-<modo>-*.json (inclui ambiente, amostras e decomposição de tempo).
 */

const T11 = 2000;
const T02 = 3000;

type Net = { name: string; ms: number; kind: string; transfer: number };

/** Entradas de rede (Resource Timing) do próprio navegador: duração e tamanho de JS/CSS e das chamadas /api. */
async function resources(page: Page): Promise<Net[]> {
  return page.evaluate(() =>
    performance.getEntriesByType('resource').map(e => {
      const r = e as PerformanceResourceTiming;
      const u = new URL(r.name);
      return { name: u.pathname + u.search.slice(0, 60), ms: r.duration, kind: r.initiatorType, transfer: r.transferSize };
    }),
  );
}
/** Decomposição da carga (relativa ao início da navegação): fim do HTML, DOMContentLoaded, último JS/CSS, última chamada /api e "agora". */
async function breakdown(page: Page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const end = (f: (r: PerformanceResourceTiming) => boolean) => Math.max(0, ...res.filter(f).map(r => r.responseEnd));
    return {
      htmlEnd: nav.responseEnd,
      domContentLoaded: nav.domContentLoadedEventEnd,
      lastAssetEnd: end(r => /\.(js|css)(\?|$)/.test(new URL(r.name).pathname)),
      lastApiEnd: end(r => new URL(r.name).pathname.startsWith('/api/')),
      now: performance.now(),
    };
  });
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

async function coldContext(browser: Browser, storageState?: Awaited<ReturnType<BrowserContext['storageState']>>) {
  return browser.newContext({ viewport: MOBILE, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', baseURL: WEB_URL, storageState });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  console.log(`[perf] modo=${MODE} web=${WEB_URL} asserts=${ASSERT} runs=${RUNS}`);
  console.log(`[perf] ambiente: ${JSON.stringify(environment())}`);
});

test('P11 · ficha 11: abrir a busca → lista ordenada por distância com status "aceitando pedidos" (frio × quente)', async ({ browser }) => {
  const cold: number[] = [];
  const warm: number[] = [];
  const coldHome: number[] = [];
  const coldApi: number[] = [];
  const coldJs: number[] = [];
  const coldJsKb: number[] = [];
  const warmApi: number[] = [];

  for (let i = 0; i < RUNS; i++) {
    const ctx = await coldContext(browser); // cache vazio
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto('/');
    const explore = page.getByRole('button', { name: 'Explorar restaurantes' });
    await explore.waitFor();
    coldHome.push(Date.now() - t0); // navegação + bundle inicial + 1º render

    await explore.click();
    const restaurants = page.getByRole('button', { name: 'Restaurantes' });
    await restaurants.waitFor();
    const t1 = Date.now();
    await restaurants.dispatchEvent('click');
    await page.getByText(/estabelecimentos? encontrados?/).waitFor();
    await page.getByText(/Aceitando pedidos|Aberto|Pedidos pausados|Alta demanda/).first().waitFor();
    cold.push(Date.now() - t1);

    const res = await resources(page);
    const api = res.filter(r => r.name.startsWith('/api/restaurants'));
    expect(api.length, 'a tela chamou /api/restaurants').toBeGreaterThan(0);
    coldApi.push(Math.max(...api.map(r => r.ms)));
    const js = res.filter(r => /\.js$/.test(r.name));
    coldJs.push(sum(js.map(r => r.ms)));
    coldJsKb.push(sum(js.map(r => r.transfer)) / 1024);

    // quente: volta ao início e abre a busca de novo (bundle e chunk da tela em cache; API consultada outra vez)
    await page.getByRole('button', { name: 'Início' }).dispatchEvent('click');
    await page.getByRole('button', { name: 'Restaurantes' }).waitFor();
    await page.evaluate(() => performance.clearResourceTimings());
    const t2 = Date.now();
    await page.getByRole('button', { name: 'Restaurantes' }).dispatchEvent('click');
    await page.getByText(/estabelecimentos? encontrados?/).waitFor();
    await page.getByText(/Aceitando pedidos|Aberto|Pedidos pausados|Alta demanda/).first().waitFor();
    warm.push(Date.now() - t2);
    const wres = (await resources(page)).filter(r => r.name.startsWith('/api/restaurants'));
    if (wres.length) warmApi.push(Math.max(...wres.map(r => r.ms)));
    await ctx.close();
  }

  const out = {
    ficha: 11,
    metaMs: T11,
    nota: 'A meta da ficha é a LATÊNCIA DA BUSCA (clique → lista). O tempo de abertura do app (coldHomeLoad ≈ 2,5 s, inclui o splash de 1,8 s em lançamento simples) é registrado, mas NÃO é o critério da ficha 11.',
    definicao: 'cold/warm = clique em "Restaurantes" → texto "N estabelecimentos encontrados" + selo de status visível (contexto novo × mesma página)',
    cold: summarize(cold),
    warm: summarize(warm),
    coldHomeLoad: summarize(coldHome),
    coldApiRequestMs: summarize(coldApi),
    warmApiRequestMs: summarize(warmApi),
    coldJsLoadMsSum: summarize(coldJs),
    coldJsTransferKB: summarize(coldJsKb),
  };
  writeReport('ficha11', out);
  console.log(`[perf][11] ${MODE} FRIO ${fmt(out.cold)}\n[perf][11] ${MODE} QUENTE ${fmt(out.warm)}\n[perf][11] API (frio) ${fmt(out.coldApiRequestMs)} | home carregada ${fmt(out.coldHomeLoad)}`);
  test.info().annotations.push({ type: 'ficha 11', description: `frio ${fmt(out.cold)} · quente ${fmt(out.warm)} · meta ${T11} ms` });
  if (ASSERT) {
    expect(out.cold.p95, `ficha 11 (frio, p95): ${fmt(out.cold)}`).toBeLessThanOrEqual(T11);
    expect(out.cold.median, `ficha 11 (frio, mediana)`).toBeLessThanOrEqual(T11);
    expect(out.warm.p95, `ficha 11 (quente, p95): ${fmt(out.warm)}`).toBeLessThanOrEqual(T11);
  }
});

test('P11b · ficha 11: API de busca por distância (sem navegador) — ordenação e latência', async () => {
  const api = await Api.create();
  const q = { lat: -22.9056, lng: -47.0608, sort: 'distance', radiusKm: 50 };
  const ms: number[] = [];
  for (let i = 0; i < RUNS * 3; i++) {
    const r = await api.get('restaurants', q);
    expect(r.status).toBe(200);
    const d = r.body.items.map((x: any) => x.distanceM);
    expect([...d].sort((a: number, b: number) => a - b)).toEqual(d); // ordenado por distância
    expect(r.body.items.every((x: any) => ['open', 'busy', 'paused', 'closed'].includes(x.orderingStatus))).toBe(true); // status presente
    ms.push(r.ms);
  }
  const first = ms[0];
  const rest = summarize(ms.slice(1));
  writeReport('ficha11-api', { ficha: 11, primeiraChamadaMs: first, demais: rest });
  console.log(`[perf][11b] API restaurants: 1ª ${first} ms; demais ${fmt(rest)}`);
  if (ASSERT) expect(rest.p95, `API /restaurants p95 ${fmt(rest)} (meta 2 s inclui o render; a API deve ser uma fração disso)`).toBeLessThanOrEqual(500);
});

test('P02 · ficha 02: abrir o link do QR → cardápio da mesa certa com pedido associado à mesa (frio × quente)', async ({ browser }) => {
  const seedApi = await Api.as(ACCOUNTS.client.email);
  const probe = await coldContext(browser);
  await loginContext(probe, ACCOUNTS.client.email, PASSWORD);
  const state = await probe.storageState(); // uma sessão só; cada repetição usa um contexto NOVO (cache vazio) com esses cookies
  await probe.close();

  const cold: number[] = [];
  const warm: number[] = [];
  const scanToConfirm: number[] = [];
  const confirmToMenu: number[] = [];
  const coldApi: number[] = [];
  const bdAsset: number[] = [];
  const bdApi: number[] = [];
  const bdGap: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const ctx = await coldContext(browser, state);
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(`/?mesa=${QR.mesa5}`);
    await page.getByText('QR Code lido com sucesso').waitFor({ timeout: 10_000 }).catch(e => {
      console.log(`[perf][02] FALHA FRIA iteração ${i}: confirmação do QR não apareceu (URL ${page.url()}, ${Date.now() - t0} ms)`);
      throw e;
    });
    const t1 = Date.now();
    scanToConfirm.push(t1 - t0);
    const b = await breakdown(page);
    bdAsset.push(b.lastAssetEnd);
    bdApi.push(b.lastApiEnd);
    bdGap.push(b.now - Math.max(b.lastAssetEnd, b.lastApiEnd)); // tempo entre o fim da rede e a tela aparecer (sem rede)
    await page.getByRole('button', { name: 'Entrar no bar' }).click();
    await page.getByRole('navigation').getByRole('button', { name: 'Cardápio' }).dispatchEvent('click');
    await page.getByText('Bar do Mestre · Mesa 5').waitFor();
    await page.getByLabel('Buscar no cardápio').waitFor();
    const t2 = Date.now();
    confirmToMenu.push(t2 - t1);
    cold.push(t2 - t0);
    const res = await resources(page);
    const api = res.filter(r => r.name.startsWith('/api/'));
    coldApi.push(Math.max(...api.map(r => r.ms)));

    // "pedido já associado à mesa": o app envia a mesa pelo código; o contexto mostra "Mesa 5" no cardápio (verificado acima)
    // e a API resolve o mesmo código para a mesa e o bar corretos.
    if (i === 0) {
      const info = await seedApi.get(`restaurants/qr/${QR.mesa5}`);
      expect(info.status).toBe(200);
      expect(JSON.stringify(info.body)).toContain('Mesa 5');
    }

    // quente: mesma aba, recarrega o link (bundle em cache)
    const w0 = Date.now();
    await page.goto(`/?mesa=${QR.mesa5}`);
    await page.getByText('QR Code lido com sucesso').waitFor({ timeout: 10_000 }).catch(e => {
      console.log(`[perf][02] FALHA QUENTE iteração ${i}: confirmação do QR não apareceu (URL ${page.url()}, ${Date.now() - w0} ms)`);
      throw e;
    });
    await page.getByRole('button', { name: 'Entrar no bar' }).click();
    await page.getByRole('navigation').getByRole('button', { name: 'Cardápio' }).dispatchEvent('click');
    await page.getByText('Bar do Mestre · Mesa 5').waitFor();
    warm.push(Date.now() - w0);
    await ctx.close();
  }
  const out = {
    ficha: 2,
    metaMs: T02,
    definicao: 'goto /?mesa=CODIGO → "QR Code lido com sucesso" → "Entrar no bar" → aba Cardápio → "Bar do Mestre · Mesa 5" visível',
    cold: summarize(cold),
    warm: summarize(warm),
    scanToConfirm: summarize(scanToConfirm),
    confirmToMenu: summarize(confirmToMenu),
    coldSlowestApiCallMs: summarize(coldApi),
    breakdown_lastAssetEndMs: summarize(bdAsset),
    breakdown_lastApiEndMs: summarize(bdApi),
    breakdown_gapAfterNetworkMs: summarize(bdGap),
    leitura: 'gapAfterNetwork = tempo em que a página ficou SEM rede pendente antes de mostrar a confirmação (temporizadores/render). Se ≈ constante e grande, é espera artificial da UI (ex.: splash), não rede/JS/API/banco.',
  };
  writeReport('ficha02', out);
  console.log(`[perf][02] ${MODE} FRIO ${fmt(out.cold)}\n[perf][02] ${MODE} QUENTE ${fmt(out.warm)}\n[perf][02] link→confirmação ${fmt(out.scanToConfirm)} | confirmação→cardápio ${fmt(out.confirmToMenu)} | API mais lenta ${fmt(out.coldSlowestApiCallMs)}\n[perf][02] rede: último JS/CSS ${fmt(out.breakdown_lastAssetEndMs)} | última /api ${fmt(out.breakdown_lastApiEndMs)} | espera pós-rede ${fmt(out.breakdown_gapAfterNetworkMs)}`);
  test.info().annotations.push({ type: 'ficha 02', description: `frio ${fmt(out.cold)} · quente ${fmt(out.warm)} · meta ${T02} ms` });
  if (ASSERT) {
    expect(out.cold.p95, `ficha 02 (frio, p95): ${fmt(out.cold)}`).toBeLessThanOrEqual(T02);
    expect(out.cold.median).toBeLessThanOrEqual(T02);
    expect(out.warm.p95, `ficha 02 (quente, p95): ${fmt(out.warm)}`).toBeLessThanOrEqual(T02);
  }
});

test('P03 · ficha 03: abrir "Ver cardápio" → itens com foto, nome, descrição e preço (frio × quente)', async ({ browser }) => {
  const cold: number[] = [];
  const warm: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const ctx = await coldContext(browser);
    const page = await ctx.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Explorar restaurantes' }).click();
    await page.getByRole('button', { name: 'Restaurantes' }).dispatchEvent('click');
    await page.getByText('Bar do Mestre', { exact: true }).first().click();
    const verCardapio = page.getByRole('button', { name: 'Ver cardápio' });
    await verCardapio.waitFor();
    const item = page.getByRole('button', { name: /Cerveja IPA 600ml/ });
    const t0 = Date.now();
    await verCardapio.dispatchEvent('click');
    await page.getByRole('button', { name: 'Cervejas', exact: true }).click();
    await item.waitFor();
    await item.locator('img').waitFor();
    await expect.poll(() => item.locator('img').evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0), { timeout: 5000 }).toBe(true); // imagem realmente carregada
    cold.push(Date.now() - t0);
    await page.getByRole('button', { name: 'Voltar' }).first().click();
    await verCardapio.waitFor();
    const t1 = Date.now();
    await verCardapio.dispatchEvent('click');
    await page.getByRole('button', { name: 'Cervejas', exact: true }).click();
    await item.waitFor();
    warm.push(Date.now() - t1);
    await ctx.close();
  }
  const out = { ficha: 3, metaMs: 2000, definicao: 'clique "Ver cardápio" → categoria Cervejas → item com foto visível', cold: summarize(cold), warm: summarize(warm) };
  writeReport('ficha03', out);
  console.log(`[perf][03] ${MODE} FRIO ${fmt(out.cold)}\n[perf][03] ${MODE} QUENTE ${fmt(out.warm)}`);
  if (ASSERT) {
    expect(out.cold.p95, `ficha 03 (frio, p95): ${fmt(out.cold)}`).toBeLessThanOrEqual(2000);
    expect(out.warm.p95).toBeLessThanOrEqual(2000);
  }
});

void SEED;
