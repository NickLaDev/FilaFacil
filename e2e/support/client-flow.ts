import { expect, type Page } from '@playwright/test';
import { brlRe } from './ui';

/** No cardápio do cliente: abre o item (categoria atual ou busca), ajusta quantidade e adiciona ao carrinho. */
export async function addItem(page: Page, name: string, qty = 1, notes?: string) {
  await page.getByLabel('Buscar no cardápio').fill(name);
  await page.getByRole('button', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
  for (let i = 1; i < qty; i++) await page.getByRole('button', { name: 'Aumentar quantidade' }).click();
  if (notes) await page.getByLabel('Alguma observação?').fill(notes);
  await page.getByRole('button', { name: /^Adicionar/ }).click();
  await expect(page.getByText('Adicionado ao pedido')).toBeVisible();
}

export const openCart = (page: Page) => page.getByRole('button', { name: /Ver carrinho/ }).click();

/** Linha do carrinho pelo nome do item. */
export const cartLine = (page: Page, name: string) => page.getByLabel(`Remover ${name}`).locator('xpath=ancestor::div[contains(@class,"bg-card")][1]');

export async function expectCartTotal(page: Page, cents: number) {
  await expect(page.getByText('Total', { exact: true }).locator('..')).toContainText(brlRe(cents));
}

export type Scenario = 'sim_approved' | 'sim_refused' | 'sim_error';

/** Tela de pagamento: escolhe cartão simulado com o cenário e confirma. */
export async function payWithCard(page: Page, scenario: Scenario = 'sim_approved', kind: 'credit' | 'debit' = 'credit') {
  await page.getByRole('button', { name: kind === 'credit' ? /Cartão de crédito/ : /Cartão de débito/ }).click();
  const label = { sim_approved: 'Pagamento aprovado', sim_refused: 'Pagamento recusado', sim_error: 'Falha de processamento' }[scenario];
  await page.getByRole('radio', { name: new RegExp(label) }).check();
  await page.getByRole('button', { name: /^Pagar com/ }).click();
}
