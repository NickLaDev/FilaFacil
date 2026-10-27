import { Gift, Star } from 'lucide-react';
import type { LoyaltyEntryDto } from '@filafacil/shared';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { cn, formatCents, formatDateTime } from '@/lib/utils';
import { useLoyalty } from '@/services/clientExtrasService';
import { ScreenHeader } from '../components/Layout';
import { useClient } from '../clientContext';

const ENTRY_LABEL: Record<LoyaltyEntryDto['type'], string> = {
  earn: 'Pontos ganhos',
  redeem: 'Pontos resgatados',
  redeem_return: 'Pontos devolvidos',
  earn_reversal: 'Pontos estornados',
};

/** Ficha 14: saldo, extrato e regras do FilaZero Club; o resgate é escolhido no pagamento do pedido. */
export function ClubScreen() {
  const { go, table } = useClient();
  const query = useLoyalty(true);
  const data = query.data;

  return (
    <div className="min-h-screen bg-background flex flex-col pb-24">
      <ScreenHeader title="FilaZero Club" onBack={() => go('profile')} />
      {query.error && !data ? (
        <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
      ) : !data ? (
        <LoadingBlock className="py-16" />
      ) : (
        <div className="px-5 py-5 flex flex-col gap-4">
          <div className="bg-primary text-primary-foreground rounded-2xl p-5 flex flex-col gap-1">
            <p className="text-xs uppercase tracking-widest opacity-80 flex items-center gap-1.5"><Star size={12} />Seu saldo</p>
            <p data-testid="club-balance" className="font-display font-extrabold text-4xl">{data.balancePoints} pts</p>
            <p data-testid="club-balance-value" className="text-sm opacity-90">Vale {formatCents(data.balanceValueCents)} em descontos</p>
          </div>

          {!data.eligible && (
            <div role="note" className="bg-warning-bg border border-warning/30 rounded-xl px-4 py-3 text-sm text-warning">
              Confirme seu e-mail ou celular para ganhar e resgatar pontos.
            </div>
          )}

          <div className="bg-card border border-border rounded-xl p-4 text-sm flex flex-col gap-2">
            <p className="font-display font-semibold text-foreground flex items-center gap-2"><Gift size={14} />Como funciona</p>
            <p className="text-muted-foreground">Você ganha 1 ponto a cada {formatCents(data.rules.centsPerPoint)} pagos, depois que o pedido é entregue.</p>
            <p className="text-muted-foreground">{data.rules.redeemBlockPoints} pontos valem {formatCents(data.rules.redeemBlockCents)} de desconto. Escolha o resgate na hora de pagar o pedido (o total nunca fica abaixo de {formatCents(data.rules.minNetCents)}).</p>
            <p className="text-muted-foreground">Se o pedido for cancelado ou estornado, os pontos ganhos são revertidos e os resgatados voltam para você.</p>
          </div>

          <button onClick={() => go(table ? 'menu' : 'qr-scanner')} className="w-full bg-card border border-border text-foreground font-medium py-3.5 rounded-xl text-sm">
            {table ? 'Ver cardápio' : 'Escanear QR Code'}
          </button>

          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Extrato</p>
            {data.entries.length === 0 ? (
              <p data-testid="club-empty" className="text-sm text-muted-foreground bg-card border border-border rounded-xl px-4 py-5 text-center">Nenhuma movimentação ainda.</p>
            ) : (
              <ul className="bg-card border border-border rounded-xl divide-y divide-border">
                {data.entries.map(entry => (
                  <li key={entry.id} data-testid="club-entry" data-entry-type={entry.type} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
                    <div>
                      <p className="text-foreground font-medium">{ENTRY_LABEL[entry.type]}{entry.orderNumber ? ` · Pedido #${entry.orderNumber}` : ''}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}{entry.note ? ` · ${entry.note}` : ''}</p>
                    </div>
                    <span className={cn('font-display font-bold', entry.points >= 0 ? 'text-success' : 'text-error')}>{entry.points > 0 ? '+' : ''}{entry.points}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
