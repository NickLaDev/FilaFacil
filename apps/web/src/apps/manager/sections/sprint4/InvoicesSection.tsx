import { Receipt } from 'lucide-react';
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from '@filafacil/shared';
import EmptyState from '@/components/ui/EmptyState';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { cn, formatCents, formatDateTime } from '@/lib/utils';
import { useEstablishmentInvoices } from '@/services/sprint4StaffService';
import type { ManagerSectionProps } from '../../types';

const INVOICE_STYLE: Record<InvoiceStatus, string> = {
  pending: 'bg-warning-bg text-warning',
  paid: 'bg-success-bg text-success',
  overdue: 'bg-error-bg text-error',
  cancelled: 'bg-muted text-muted-foreground',
};

const brDate = (iso: string) => iso.split('-').reverse().join('/');
const monthLabel = (period: string) => `${period.slice(5)}/${period.slice(0, 4)}`;

/** Ficha 38 (lado do estabelecimento): faturas da plataforma com status. */
export default function InvoicesSection({ unit }: ManagerSectionProps) {
  const query = useEstablishmentInvoices(unit.id);
  if (query.error && !query.data) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingBlock />;
  const overdue = query.data.filter(invoice => invoice.status === 'overdue');
  return (
    <div className="p-6 flex flex-col gap-4 max-w-4xl">
      {overdue.length > 0 && <p role="alert" data-testid="overdue-notice" className="text-sm text-error bg-error-bg border border-error/30 rounded-xl px-4 py-3">Você tem {overdue.length} {overdue.length === 1 ? 'fatura em atraso' : 'faturas em atraso'} ({formatCents(overdue.reduce((sum, invoice) => sum + invoice.amountCents, 0))}). Regularize para evitar bloqueios.</p>}
      {query.data.length === 0 ? (
        <div className="bg-card rounded-xl border border-border"><EmptyState icon={Receipt} title="Nenhuma fatura" description="As faturas mensais do seu plano aparecem aqui." /></div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground uppercase tracking-wider"><th className="px-4 py-3">Competência</th><th className="px-4 py-3">Plano</th><th className="px-4 py-3">Vencimento</th><th className="px-4 py-3 text-right">Valor</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody>
              {query.data.map(invoice => (
                <tr key={invoice.id} data-testid="invoice-row" data-status={invoice.status} className="border-t border-border text-sm">
                  <td className="px-4 py-3 font-medium text-foreground">{monthLabel(invoice.period)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{invoice.planName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{brDate(invoice.dueDate)}</td>
                  <td className="px-4 py-3 text-right">{formatCents(invoice.amountCents)}</td>
                  <td className="px-4 py-3"><span className={cn('text-xs font-bold px-2.5 py-1 rounded-full', INVOICE_STYLE[invoice.status])}>{INVOICE_STATUS_LABELS[invoice.status]}</span>{invoice.paidAt && <span className="block text-[11px] text-muted-foreground mt-1">Pago em {formatDateTime(invoice.paidAt)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
