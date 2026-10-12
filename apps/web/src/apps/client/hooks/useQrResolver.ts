import { useRef, useState } from 'react';
import { isApiError } from '@/lib/api/client';
import { resolveQrCode } from '@/services/floorService';
import { useClient } from '../clientContext';
import type { ClientScreen, TableContext } from '../types';

/**
 * Converte o código lido/digitado em mesa + estabelecimento e decide o próximo passo:
 * QR inválido, estabelecimento fechado ou confirmação da mesa (ficha 02). A API resolve o código
 * (inclusive de mesas criadas depois do seed) e já informa se a casa está aceitando pedidos.
 */
export function useQrResolver() {
  const { go, setTable, cart, cartEstablishmentId, clearCart, showToast } = useClient();
  const [pendingSwitch, setPendingSwitch] = useState<TableContext | null>(null);
  const pendingAccepting = useRef(true);

  function enterTable(table: TableContext, acceptingOrders: boolean) {
    setTable(table);
    go(acceptingOrders ? 'bar-confirm' : 'bar-closed');
  }

  /** Resolve `false` quando o código não existe (a tela decide como mostrar o erro). */
  async function resolve(code: string, { invalidScreen = true, fallback }: { invalidScreen?: boolean; fallback?: ClientScreen } = {}) {
    let match;
    try {
      match = await resolveQrCode(code);
    } catch (error) {
      // Sem rede ou servidor fora do ar: não é um QR inválido.
      showToast(isApiError(error) && error.status === 429 ? 'Muitas leituras seguidas. Aguarde um instante.' : 'Não foi possível ler o QR Code agora. Verifique sua conexão.');
      if (fallback) go(fallback);
      return false;
    }
    if (!match) {
      if (invalidScreen) go('qr-invalid');
      return false;
    }
    const table = { establishmentId: match.establishmentId, tableId: match.tableId, tableLabel: match.tableLabel };
    if (cart.length > 0 && cartEstablishmentId !== match.establishmentId) {
      pendingAccepting.current = match.acceptingOrders;
      setPendingSwitch(table);
    } else {
      enterTable(table, match.acceptingOrders);
    }
    return true;
  }

  function confirmSwitch() {
    if (!pendingSwitch) return;
    clearCart();
    enterTable(pendingSwitch, pendingAccepting.current);
    setPendingSwitch(null);
  }

  return { resolve, pendingSwitch, confirmSwitch, cancelSwitch: () => setPendingSwitch(null) };
}
