import { useState } from 'react';
import { PlayCircle, Receipt } from 'lucide-react';
import { INVOICE_STATUS_LABELS, type InvoiceDto, type InvoiceStatus } from '@filafacil/shared';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { formatCents, formatDateTime } from '@/lib/utils';
import { cancelInvoice, markInvoicePaid, runBilling, useAdminInvoices } from '@/services/sprint4StaffService';
import ConfirmDialog from '../components/ConfirmDialog';
import FilterChips from '../components/FilterChips';
import Pagination from '../components/Pagination';
import { Pill } from '../components/Pills';
import SearchBox from '../components/SearchBox';

const STYLE: Record<InvoiceStatus, string> = { pending: 'bg-warning-bg text-warning', paid: 'bg-success/10 text-success', overdue: 'bg-error/10 text-error', cancelled: 'bg-muted text-muted-foreground' };
const brDate = (iso: string) => iso.split('-').reverse().join('/');
const monthLabel = (period: string) => `${period.slice(5)}/${period.slice(0, 4)}`;

/** Ficha 38: faturas de todos os estabelecimentos (pago, pendente, atrasado), cobrança recorrente automática e registro de pagamento. */
export default function BillingSection({ notify }: { notify: (message: string) => void }) {
  const [status, setStatus] = useState<InvoiceStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const query = useAdminInvoices({ status: status === 'all' ? undefined : status, q: q.trim() || undefined, page });
  const { run, pending } = useAsyncAction(notify);
  const [cancelling, setCancelling] = useState<InvoiceDto | null>(null);

  if (query.error && !query.data) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingBlock />;
  const data = query.data;

  return (
    <div className="p-6 flex flex-col gap-4 max-w-6xl">
      <div className="flex items-center gap-3 flex-wrap">
        <FilterChips
          label="Status das faturas"
          value={status}
          onChange={value => { setStatus(value); setPage(1); }}
          options={[
            { id: 'all', label: 'Todas', count: data.counts.all },
            { id: 'pending', label: 'Pendentes', count: data.counts.pending },
            { id: 'overdue', label: 'Atrasadas', count: data.counts.overdue },
            { id: 'paid', label: 'Pagas', count: data.counts.paid },
            { id: 'cancelled', label: 'Canceladas', count: data.counts.cancelled },
          ]}
        />
        <SearchBox value={q} onChange={value => { setQ(value); setPage(1); }} placeholder="Buscar estabelecimento" />
        <button onClick={() => void run(() => runBilling(), result => `Cobrança executada: ${result.generated} fatura(s) gerada(s), ${result.markedOverdue} marcada(s) como atrasada(s), ${result.notified} aviso(s) enviado(s)`)} disabled={pending} data-testid="run-billing" className="flex items-center gap-2 border border-border rounded-xl px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"><PlayCircle size={14} />Executar cobrança agora</button>
      </div>
      <p className="text-sm text-muted-foreground">As faturas do mês são geradas automaticamente. Vencida, a fatura vira “atrasada” e o estabelecimento é avisado no dia seguinte (e a cada 3 dias enquanto durar).
        {data.overdueCents > 0 && <> Em atraso: <strong data-testid="overdue-total" className="text-error">{formatCents(data.overdueCents)}</strong>.</>}</p>

      <div className="bg-card rounded-xl border border-border overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground uppercase tracking-wider"><th className="px-4 py-3">Estabelecimento</th><th className="px-4 py-3">Competência</th><th className="px-4 py-3">Plano</th><th className="px-4 py-3">Vencimento</th><th className="px-4 py-3 text-right">Valor</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Ações</th></tr></thead>
          <tbody>
            {data.items.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground"><Receipt size={16} className="inline mr-2" />Nenhuma fatura encontrada.</td></tr>}
            {data.items.map(invoice => (
              <tr key={invoice.id} data-testid="admin-invoice" data-status={invoice.status} className="border-t border-border text-sm">
                <td className="px-4 py-3 font-medium text-foreground">{invoice.establishmentName}</td>
                <td className="px-4 py-3">{monthLabel(invoice.period)}</td>
                <td className="px-4 py-3 text-muted-foreground">{invoice.planName}</td>
                <td className="px-4 py-3 text-muted-foreground">{brDate(invoice.dueDate)}</td>
                <td className="px-4 py-3 text-right">{formatCents(invoice.amountCents)}</td>
                <td className="px-4 py-3"><Pill className={STYLE[invoice.status]}>{INVOICE_STATUS_LABELS[invoice.status]}</Pill>{invoice.paidAt && <span className="block text-[11px] text-muted-foreground mt-1">{formatDateTime(invoice.paidAt)}</span>}</td>
                <td className="px-4 py-3">
                  {(invoice.status === 'pending' || invoice.status === 'overdue') && (
                    <div className="flex gap-2">
                      <button onClick={() => void run(() => markInvoicePaid(invoice.id), 'Pagamento registrado')} className="text-xs font-semibold text-success border border-success/30 rounded-lg px-2.5 py-1">Registrar pagamento</button>
                      <button onClick={() => setCancelling(invoice)} className="text-xs font-semibold text-muted-foreground border border-border rounded-lg px-2.5 py-1">Cancelar</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
      </div>
      {cancelling && <ConfirmDialog title="Cancelar fatura" tone="danger" busy={pending} description={`A fatura ${monthLabel(cancelling.period)} de ${cancelling.establishmentName} (${formatCents(cancelling.amountCents)}) será cancelada e deixa de ser cobrada.`} confirmLabel="Cancelar fatura" onConfirm={() => void run(() => cancelInvoice(cancelling.id), 'Fatura cancelada').then(() => setCancelling(null))} onClose={() => setCancelling(null)} />}
    </div>
  );
}
