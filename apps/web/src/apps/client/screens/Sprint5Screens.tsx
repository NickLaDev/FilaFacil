import { Copy, Ticket } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { cn, formatDate } from '@/lib/utils';
import { useMyOffers } from '@/services/sprint5Service';
import { useClient } from '../clientContext';
import { ScreenHeader } from '../components/Layout';

/** Ficha 68: cupons pessoais recebidos em campanhas (aniversário, volta, cliente frequente). */
export function OffersScreen() {
  const { go, showToast } = useClient();
  const query = useMyOffers(true);

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      showToast('Cupom copiado — use no pagamento');
    } catch {
      showToast(`Cupom: ${code}`);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-24">
      <ScreenHeader title="Minhas ofertas" onBack={() => go('profile')} />
      {query.error && !query.data ? (
        <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <LoadingBlock className="py-16" />
      ) : query.data.length === 0 ? (
        <EmptyState icon={Ticket} title="Nenhuma oferta por enquanto" description="Restaurantes enviam cupons só para você — no aniversário (informe a data no perfil), quando sente sua falta ou para clientes frequentes." />
      ) : (
        <ul className="px-5 py-5 flex flex-col gap-3">
          {query.data.map(offer => (
            <li key={offer.code} data-testid="offer-card" data-used={offer.used} className={cn('bg-card border border-border rounded-2xl p-4 flex flex-col gap-2', offer.used && 'opacity-60')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display font-semibold text-foreground">{offer.establishmentName}</p>
                  <p className="text-sm text-muted-foreground">{offer.description}</p>
                </div>
                {offer.used && <span className="text-[11px] font-bold bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Usado</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold tracking-wider whitespace-nowrap border-2 border-dashed border-primary/40 text-primary rounded-lg px-3 py-1.5">{offer.code}</span>
                {!offer.used && <button onClick={() => void copy(offer.code)} aria-label={`Copiar ${offer.code}`} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><Copy size={15} /></button>}
                <span className="ml-auto text-xs text-muted-foreground">até {formatDate(offer.endsAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
