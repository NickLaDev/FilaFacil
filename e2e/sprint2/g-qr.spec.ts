import { expect, test } from '@playwright/test';
import path from 'node:path';
import { ACCOUNTS, QR, ROOT, SEED, WEB_URL } from '../support/env';
import { dbQuery } from '../support/db';
import { makeQrY4m } from '../support/fake-camera';
import { recordMetric } from '../support/metrics';
import { newClientContext, newStaffContext } from '../support/ui';

// Ficha 02 — QR Code para pedido: QR único por mesa, QR gerado pelo gestor decodificável, leitor do app com "câmera" virtual.
const JSQR = path.join(ROOT, 'apps/web/node_modules/jsqr/dist/jsQR.js');
const y4m = makeQrY4m(`${WEB_URL}/?mesa=${QR.mesa5}`);

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] },
  permissions: ['camera'],
});

test('G1 · QR único por mesa; QR gerado no painel do gestor decodifica para o link da mesa certa e abre o cardápio vinculado', async ({ browser }) => {
  // unicidade no banco (índice único) e formato
  const dup = await dbQuery("select qr_code, count(*) from dining_tables group by qr_code having count(*) > 1");
  expect(dup).toHaveLength(0);
  expect((await dbQuery("select 1 from dining_tables where qr_code is null or qr_code = ''"))).toHaveLength(0);

  const mgrCtx = await newStaffContext(browser, ACCOUNTS.manager.email);
  const mgr = await mgrCtx.newPage();
  await mgr.goto('/gestor');
  await mgr.getByRole('button', { name: 'QR Codes' }).click();
  await expect(mgr.getByText('QR Codes ativos')).toBeVisible({ timeout: 15_000 });
  const rows = await mgr.locator('tbody tr').count();
  expect(rows).toBe(Number((await dbQuery<any>('select count(*)::int c from dining_tables where establishment_id=$1', [SEED.mestre]))[0].c));
  await mgr.getByLabel('Visualizar QR da Mesa 8').click();
  const img = mgr.getByAltText('QR Code da Mesa 8');
  await expect(img).toBeVisible({ timeout: 8000 });
  await mgr.addScriptTag({ path: JSQR });
  const decoded = await mgr.evaluate(async () => {
    const el = document.querySelector('img[alt="QR Code da Mesa 8"]') as HTMLImageElement;
    await el.decode();
    const c = document.createElement('canvas');
    c.width = el.naturalWidth; c.height = el.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(el, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    // @ts-expect-error global injetado
    return jsQR(d.data, d.width, d.height)?.data ?? null;
  });
  expect(decoded).toBe(`${WEB_URL}/?mesa=${QR.mesa8}`);
  await mgrCtx.close();

  // cliente abre o link decodificado: mesa 8 do Bar do Mestre
  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();
  await page.goto(decoded!.replace(WEB_URL, ''));
  await expect(page.getByText('QR Code lido com sucesso')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Mesa 8', { exact: true })).toBeVisible();
  await ctx.close();
});

test('G2 · leitor do app com câmera virtual: lê o QR da mesa e abre a confirmação do bar/mesa em ≤ 3 s', async ({ browser }) => {
  const ctx = await newClientContext(browser, { email: ACCOUNTS.client.email });
  const page = await ctx.newPage();
  await page.goto('/');
  const tile = page.getByRole('button', { name: /Já está no local\?/ });
  await expect(tile).toBeVisible({ timeout: 15_000 });
  const t0 = Date.now();
  await tile.click();
  await expect(page.getByText('QR Code lido com sucesso')).toBeVisible({ timeout: 10_000 });
  const ms = Date.now() - t0;
  recordMetric('ficha 02: abrir leitor → QR (câmera virtual) lido → bar/mesa confirmados', ms, 3000);
  await expect(page.getByText('Mesa 5', { exact: true })).toBeVisible();
  await expect(page.getByText('Bar do Mestre', { exact: true }).first()).toBeVisible();
  expect(ms).toBeLessThanOrEqual(3000);
  await page.getByRole('button', { name: 'Entrar no bar' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Cardápio' }).dispatchEvent('click');
  await expect(page.getByText('Bar do Mestre · Mesa 5')).toBeVisible();
  await ctx.close();
});
