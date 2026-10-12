import { expect, type Browser, type Page } from '@playwright/test';
import { loginContext } from './api';
import { PASSWORD, WEB_URL } from './env';
import { otpMark, waitForOtp } from './otp';

export const MOBILE = { width: 390, height: 844 };

/** Contexto de navegador isolado (cookies/storage próprios): cliente em viewport móvel, equipe em desktop. */
export async function newClientContext(browser: Browser, opts: { email?: string; password?: string; fresh?: boolean } = {}) {
  const context = await browser.newContext({ viewport: MOBILE, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', baseURL: WEB_URL });
  if (opts.email) await loginContext(context, opts.email, opts.password ?? PASSWORD, { fresh: opts.fresh });
  return context;
}

export async function newStaffContext(browser: Browser, email: string, password = PASSWORD, fresh = false) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', baseURL: WEB_URL });
  await loginContext(context, email, password, { fresh });
  return context;
}

/** Abre o app do cliente e espera a splash terminar (home ou boas-vindas). */
export async function openClient(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.getByRole('button', { name: /Escanear QR Code|Início/ }).first()).toBeVisible({ timeout: 15_000 });
}

/** Cliente já logado (cookie): entra pelo link do QR (/?mesa=CODIGO), confirma o bar e chega à home da mesa. */
export async function enterTableByLink(page: Page, code: string) {
  await page.goto(`/?mesa=${encodeURIComponent(code)}`);
  await expect(page.getByText('QR Code lido com sucesso')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Entrar no bar' }).click();
}

/** Fluxo de teclado do leitor: "Escanear QR Code" → "Digitar código". */
export async function enterTableByManualCode(page: Page, code: string) {
  await page.getByRole('button', { name: /Escanear QR Code/ }).click();
  await page.getByText('Digitar código').click();
  await page.getByLabel('Código da mesa').fill(code);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
}

/**
 * Aba da barra inferior. O botão flutuante "DEV" (só existe no modo de desenvolvimento) cobre a aba "Perfil" em 390 px;
 * por isso o clique é disparado no próprio elemento, sem depender de coordenadas.
 */
export const nav = (page: Page, tab: 'Início' | 'Cardápio' | 'Pedidos' | 'Perfil' | 'Restaurantes') => page.getByRole('navigation').getByRole('button', { name: tab }).dispatchEvent('click');

export const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
/** Aceita NBSP ou espaço comum entre "R$" e o valor. */
export const brlRe = (cents: number) => new RegExp(`R\\$\\s*${(cents / 100).toFixed(2).replace('.', ',').replace(/\./g, '\\.')}`);

/** Login pela UI (celular/e-mail + senha). */
export async function loginViaUi(page: Page, email: string, password = PASSWORD) {
  await page.getByRole('button', { name: 'Entrar', exact: true }).first().click();
  await page.getByLabel('Celular ou e-mail').fill(email);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

/** Digita os 6 dígitos nos campos "Dígito N". */
export async function typeCode(page: Page, code: string) {
  for (let i = 0; i < 6; i++) await page.getByLabel(`Dígito ${i + 1}`).fill(code[i]);
}

export { otpMark, waitForOtp };
