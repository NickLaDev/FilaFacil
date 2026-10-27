import { BellRing } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { formatTime } from '@/lib/utils';
import { resolveCall, useStaffCalls } from '@/services/operationsService';

/** Ficha 18: chamados de garçom abertos, em tempo real, com resolução. */
export default function CallsSection({ establishmentId, notify }: { establishmentId: string; notify: (message: string) => void }) {
  const query = useStaffCalls(establishmentId);
  const { run, pending } = useAsyncAction(notify);
  if (query.error && !query.data) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} className="flex-1 py-16" />;
  if (!query.data) return <LoadingBlock className="flex-1 py-16" />;
  if (query.data.length === 0) {
    return (
      <div className="flex-1 overflow-auto">
        <EmptyState icon={BellRing} title="Nenhum chamado aberto" description="Quando um cliente chamar o garçom pelo app, o chamado aparece aqui na hora." />
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-auto p-5">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 max-w-6xl">
        {query.data.map(call => (
          <li key={call.id} data-testid="table-call" className="bg-card border border-error/40 rounded-xl p-4 flex items-center justify-between gap-3">
            <div>
              <p className="font-display font-bold text-foreground">{call.tableLabel}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5"><BellRing size={12} />Chamado às {formatTime(call.createdAt)}</p>
            </div>
            <button
              disabled={pending}
              onClick={() => void run(() => resolveCall(establishmentId, call.id), `Chamado da ${call.tableLabel} atendido`)}
              aria-label={`Atender chamado da ${call.tableLabel}`}
              className="bg-error text-white text-xs font-semibold rounded-lg px-3 py-2 disabled:opacity-50"
            >
              Marcar como atendido
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
