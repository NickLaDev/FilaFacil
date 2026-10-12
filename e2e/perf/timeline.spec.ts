import { test } from '@playwright/test';
import { MOBILE } from '../support/ui';
import { QR, WEB_URL } from '../support/env';

/** Diagnóstico (não é asserção): linha do tempo de UMA carga fria do link do QR — cada requisição com início/fim e quando a confirmação aparece. */
test('timeline · link do QR (diagnóstico de onde vai o tempo)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE, baseURL: WEB_URL });
  const page = await ctx.newPage();
  await page.goto(`/?mesa=${QR.mesa5}`);
  await page.getByText('QR Code lido com sucesso').waitFor();
  const t = await page.evaluate(() => ({
    now: Math.round(performance.now()),
    res: (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map(r => ({ p: new URL(r.name).pathname.replace(/^.*\//, '').slice(0, 40), start: Math.round(r.startTime), end: Math.round(r.responseEnd) })),
  }));
  console.log('[timeline] confirmação visível em', t.now, 'ms');
  for (const r of t.res.sort((a, b) => a.start - b.start)) console.log(`[timeline] ${String(r.start).padStart(5)} → ${String(r.end).padStart(5)}  ${r.p}`);
  await ctx.close();
});
void 0;
