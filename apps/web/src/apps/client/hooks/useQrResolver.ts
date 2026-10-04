import { useState } from 'react';
import { findTableByQrCode } from '@/services/floorService';
import { fetchRestaurant } from '@/services/restaurantService';
import { useClient } from '../clientContext';
import type { TableContext } from '../types';

/**
 * Converte o código lido/digitado em mesa + estabelecimento e decide o próximo passo:
 * QR inválido, estabelecimento fechado ou confirmação da mesa (ficha 02, Sprint 2). O código é
 * resolvido localmente (ainda sem API de QR); o estabelecimento vem da API, com status real.
 */
export function useQrResolver() {
  const { go, setTable, cart, cartEstablishmentId, clearCart } = useClient();
  const [pendingSwitch, setPendingSwitch] = useState<TableContext | null>(null);

  async function enterTable(table: TableContext) {
    const establishment = await fetchRestaurant(table.establishmentId).catch(() => null);
    setTable(table);
    go(establishment?.acceptingOrders ? 'bar-confirm' : 'bar-closed');
  }

  /** Resolve `false` quando o código não existe (a tela decide como mostrar o erro). */
  async function resolve(code: string, { invalidScreen = true } = {}) {
    const match = findTableByQrCode(code);
    const establishment = match ? await fetchRestaurant(match.establishmentId).catch(() => null) : null;
    if (!match || !establishment) {
      if (invalidScreen) go('qr-invalid');
      return false;
    }
    const table = { establishmentId: establishment.id, tableId: match.table.id, tableLabel: match.table.label };
    if (cart.length > 0 && cartEstablishmentId !== establishment.id) setPendingSwitch(table);
    else await enterTable(table);
    return true;
  }

  function confirmSwitch() {
    if (!pendingSwitch) return;
    clearCart();
    void enterTable(pendingSwitch);
    setPendingSwitch(null);
  }

  return { resolve, pendingSwitch, confirmSwitch, cancelSwitch: () => setPendingSwitch(null) };
}
