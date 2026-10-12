import { expect, test, type Page } from '@playwright/test';
import { Api } from '../support/api';
import { ACCOUNTS, PASSWORD, QR, SEED, WEB_URL } from '../support/env';
import { loginContext } from '../support/api';
import { MOBILE } from '../support/ui';

// Regressão do link do QR (/?mesa=CODIGO), ficha 02: o link NUNCA pode se perder, em qualquer momento da abertura do app.
// Contexto: o link era lido com efeito colateral (replaceState) durante a renderização; uma re-renderização inicial perdia o código
// e o app caía na home sem chamar a API (intermitente, ~1 em 3 recargas "quentes"). Sem mocks: tudo contra a API real.

const confirmOrClosed = (page: Page) => page.getByText(/QR Code lido com sucesso/);

async function loggedPage(browser: import('@playwright/test').Browser) {
  const ctx = await browser.newContext({ viewport: MOBILE, locale: 'pt-BR', baseURL: WEB_URL });
  await loginContext(ctx, ACCOUNTS.client.email, PASSWORD);
  return { ctx, page: await ctx.newPage() };
}

test('H1 · reabrir o link /?mesa= na MESMA página 10×, logado (com e sem confirmar antes): sempre a confirmação da mesa certa, sempre uma chamada à API de QR', async ({ browser }) => {
  const { ctx, page } = await loggedPage(browser);
  const qrCalls: number[] = [];
  page.on('response', r => {
    if (r.url().includes(`/api/restaurants/qr/${QR.mesa5}`)) qrCalls.push(r.status());
  });
  for (let i = 0; i < 10; i++) {
    const before = qrCalls.length;
    await page.goto(`/?mesa=${QR.mesa5}`);
    await expect(confirmOrClosed(page), `iteração ${i}: confirmação do QR`).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Mesa 5', { exact: true })).toBeVisible();
    await expect(page.getByText('Bar do Mestre', { exact: true }).first()).toBeVisible();
    expect(qrCalls.length - before, `iteração ${i}: exatamente 1 chamada ao QR`).toBe(1);
    expect(qrCalls[qrCalls.length - 1]).toBe(200);
    if (i % 2 === 1) {
      // confirma e entra; a próxima iteração reabre o link logo após uma confirmação
      await page.getByRole('button', { name: 'Entrar no bar' }).click();
      await expect(page.getByRole('navigation').getByRole('button', { name: 'Cardápio' })).toBeVisible();
    }
  }
  await ctx.close();
});

test('H2 · link aberto com a sessão ainda carregando (rede lenta emulada no Chromium, sem mock da API) e como visitante: confirmação aparece', async ({ browser }) => {
  const { ctx, page } = await loggedPage(browser);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  for (const latency of [0, 300, 800]) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: -1, uploadThroughput: -1 });
    for (let i = 0; i < 3; i++) {
      await page.goto(`/?mesa=${QR.mesa5}`);
      await expect(confirmOrClosed(page), `latência ${latency} ms, iteração ${i}`).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Mesa 5', { exact: true })).toBeVisible();
    }
  }
  await ctx.close();
  // visitante (sem sessão): o QR é público; a confirmação também aparece
  const guest = await browser.newContext({ viewport: MOBILE, locale: 'pt-BR', baseURL: WEB_URL });
  const gp = await guest.newPage();
  for (let i = 0; i < 4; i++) {
    await gp.goto(`/?mesa=${QR.mesa5}`);
    await expect(confirmOrClosed(gp), `visitante, iteração ${i}`).toBeVisible({ timeout: 10_000 });
  }
  await guest.close();
});

test('H3 · link inválido e link de casa fechada (reais, sem mock): telas corretas, repetidas na mesma página; QR válido volta a funcionar logo depois', async ({ browser }) => {
  const { ctx, page } = await loggedPage(browser);
  for (let i = 0; i < 3; i++) {
    await page.goto(`/?mesa=CODIGO-INEXISTENTE-${i}`);
    await expect(page.getByText('QR Code inválido'), `inválido, iteração ${i}`).toBeVisible({ timeout: 10_000 });
    await page.goto(`/?mesa=${QR.mesa5}`);
    await expect(confirmOrClosed(page)).toBeVisible({ timeout: 10_000 });
  }
  // casa fechada por horário (provocada agora, restaurada no fim): tela "Pedidos fechados" a cada reabertura
  const admin = await Api.as(ACCOUNTS.admin.email);
  const BM2 = SEED.mestre;
  const code = QR.mesa1;
  const allDay = [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, opensAt: '00:00', closesAt: '23:59' }));
  const today = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }));
  try {
    expect((await admin.patch(`admin/establishments/${BM2}`, { openingHours: [{ weekday: (today + 3) % 7, opensAt: '10:00', closesAt: '18:00' }] })).status).toBe(200);
    for (let i = 0; i < 3; i++) {
      await page.goto(`/?mesa=${code}`);
      await expect(page.getByText(/Pedidos fechados/), `fechado, iteração ${i}`).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('QR Code lido com sucesso')).toHaveCount(0);
    }
  } finally {
    await admin.patch(`admin/establishments/${BM2}`, { openingHours: allDay });
  }
  await page.goto(`/?mesa=${code}`);
  await expect(confirmOrClosed(page)).toBeVisible({ timeout: 10_000 });
  await ctx.close();
});
