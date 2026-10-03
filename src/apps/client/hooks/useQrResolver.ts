import { useState } from 'react';
import { findTableByQrCode } from '@/services/floorService';
import { canAcceptOrders, getEstablishment, isPubliclyVisible } from '@/services/establishmentService';
import { useClient } from '../clientContext';
import type { TableContext } from '../types';

/**
 * Converte o código lido/digitado em mesa + estabelecimento e decide o próximo passo:
 * QR inválido, estabelecimento fechado ou confirmação da mesa (ficha 02).
 */
export function useQrResolver() {
  const { go, setTable, cart, cartEstablishmentId, clearCart } = useClient();
  const [pendingSwitch, setPendingSwitch] = useState<TableContext | null>(null);

  function enterTable(table: TableContext) {
    const establishment = getEstablishment(table.establishmentId);
    setTable(table);
    go(establishment && canAcceptOrders(establishment) ? 'bar-confirm' : 'bar-closed');
  }

  /** Retorna `false` quando o código não existe (a tela decide como mostrar o erro). */
  function resolve(code: string, { invalidScreen = true } = {}) {
    const match = findTableByQrCode(code);
    const establishment = match ? getEstablishment(match.establishmentId) : null;
    if (!match || !establishment || !isPubliclyVisible(establishment)) {
      if (invalidScreen) go('qr-invalid');
      return false;
    }
    const table = { establishmentId: establishment.id, tableId: match.table.id, tableLabel: match.table.label };
    if (cart.length > 0 && cartEstablishmentId !== establishment.id) setPendingSwitch(table);
    else enterTable(table);
    return true;
  }

  function confirmSwitch() {
    if (!pendingSwitch) return;
    clearCart();
    enterTable(pendingSwitch);
    setPendingSwitch(null);
  }

  return { resolve, pendingSwitch, confirmSwitch, cancelSwitch: () => setPendingSwitch(null) };
}
