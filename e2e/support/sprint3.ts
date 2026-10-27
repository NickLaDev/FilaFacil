import { expect, type Page } from '@playwright/test';
import { Api, menuItems, paidOrder, qr } from './api';
import { QR, SEED } from './env';

/** Utilidades da Sprint 3 (somente a pilha E2E; nada daqui toca outro banco). */

export const staffBase = (establishmentId = SEED.mestre) => `establishments/${establishmentId}`;

export async function itemByName(api: Api, name: string, establishmentId = SEED.mestre) {
  const found = (await menuItems(api, establishmentId)).find(i => i.name === name);
  if (!found) throw new Error(`item "${name}" não existe no cardápio do seed`);
  return found as { id: string; name: string; price?: number; priceCents?: number };
}

export const tableIdFor = async (api: Api, code: string) => (await qr(api, code)).tableId as string;

/** Pedido pago (cartão simulado aprovado) para a mesa pelo QR. */
export async function paidOrderAt(customer: Api, manager: Api, qrCode: string, items: { name: string; quantity: number }[]) {
  const tableId = await tableIdFor(manager, qrCode);
  const lines = [];
  for (const i of items) lines.push({ menuItemId: (await itemByName(manager, i.name)).id, quantity: i.quantity });
  return paidOrder(customer, SEED.mestre, tableId, lines);
}

/** Abre o tablet do atendente na seção indicada. */
export async function openAttendant(page: Page, section: 'Mapa' | 'Pedidos' | 'Chamados' | 'Comandas' | 'Cardápio' = 'Pedidos') {
  await page.goto('/atendente');
  await page.getByRole('button', { name: section, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
}

export const orderCard = (page: Page, number: number) => page.locator('article', { has: page.getByText(`#${number}`, { exact: true }) });

/** Painel do gestor: abre uma seção do menu lateral. */
export async function openManagerSection(page: Page, label: string) {
  await page.goto('/gestor');
  await page.getByRole('button', { name: label, exact: true }).first().click();
}

/** Garante nenhum turno aberto (estado inicial determinístico). */
export async function closeShiftIfOpen(manager: Api) {
  const current = await manager.get(`${staffBase()}/shift/current`);
  if (current.status === 200 && current.body?.shift) await manager.post(`${staffBase()}/shift/close`);
}

export { QR, SEED };
