import { ChevronRight, ShieldAlert } from 'lucide-react';
import { isAccountVerified } from '@/services/authService';
import { useClient } from '../clientContext';
import type { ClientScreen } from '../types';

/** Contas não verificadas não pagam pelo app — aviso com atalho para confirmar (ficha 65). */
export default function VerificationBanner({ returnTo }: { returnTo: ClientScreen }) {
  const { account, requestVerification } = useClient();
  if (!account || isAccountVerified(account)) return null;
  const channel = account.email ? 'email' : 'phone';
  return (
    <button
      onClick={() => requestVerification({ purpose: 'contact', channel, destination: account.email || account.phone, returnTo })}
      className="w-full bg-warning-bg border border-warning/20 rounded-xl px-4 py-3 flex items-start gap-3 text-left"
    >
      <ShieldAlert size={16} className="text-warning flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-medium text-warning">Confirme seu {channel === 'email' ? 'e-mail' : 'celular'}</p>
        <p className="text-xs text-warning/80 mt-0.5">Necessário para pagar pedidos pelo app.</p>
      </div>
      <ChevronRight size={15} className="text-warning flex-shrink-0 mt-0.5" />
    </button>
  );
}
