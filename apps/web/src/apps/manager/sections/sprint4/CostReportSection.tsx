import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { cn, formatCents } from '@/lib/utils';
import { costReportExportUrl, useCostReport } from '@/services/sprint4StaffService';
import type { ManagerSectionProps } from '../../types';

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const pct = (value: number | null) => (value === null ? '—' : `${String(value).replace('.', ',')}%`);

/** Ficha 57: custo dos pratos vendidos (ficha técnica × quantidade) e margem por item e categoria. */
export default function CostReportSection({ unit }: ManagerSectionProps) {
  const now = new Date();
  const [from, setFrom] = useState(isoDay(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(isoDay(now));
  const query = useCostReport(unit.id, from, to);
  const invalid = !from || !to || from > to;
  const report = query.data;

  return (
    <div className="p-6 flex flex-col gap-4 max-w-6xl">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label htmlFor="cost-from" className="text-xs text-muted-foreground font-medium block mb-1">De</label>
          <input id="cost-from" type="date" value={from} onChange={event => setFrom(event.target.value)} className="border border-border rounded-xl px-3 py-2 text-sm bg-card" />
        </div>
        <div>
          <label htmlFor="cost-to" className="text-xs text-muted-foreground font-medium block mb-1">Até</label>
          <input id="cost-to" type="date" value={to} onChange={event => setTo(event.target.value)} className="border border-border rounded-xl px-3 py-2 text-sm bg-card" />
        </div>
        <div className="flex gap-2 ml-auto">
          {(['csv', 'pdf'] as const).map(format => (
            <a key={format} data-testid={`export-${format}`} aria-disabled={invalid} href={invalid ? undefined : costReportExportUrl(unit.id, from, to, format)} download className={cn('flex items-center gap-2 border border-border rounded-xl px-4 py-2 text-sm font-medium', invalid ? 'opacity-50 pointer-events-none' : 'hover:bg-muted')}>
              <Download size={14} />Exportar {format.toUpperCase()}
            </a>
          ))}
        </div>
      </div>
      {invalid && <p role="alert" className="text-sm text-error">A data final deve ser igual ou posterior à inicial.</p>}

      {query.error && !report ? (
        <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
      ) : !report ? (
        invalid ? null : <LoadingBlock />
      ) : report.rows.length === 0 ? (
        <div className="bg-card rounded-xl border border-border"><EmptyState icon={FileText} title="Nenhuma venda no período" description="Pedidos pagos no período escolhido aparecem aqui com custo e margem." /></div>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Kpi label="Receita" testId="cost-revenue" value={formatCents(report.totals.revenueCents)} />
            <Kpi label="Custo (itens com ficha)" testId="cost-total" value={formatCents(report.totals.costCents)} />
            <Kpi label="Margem" testId="cost-margin" value={formatCents(report.totals.marginCents)} />
            <Kpi label="Margem %" testId="cost-margin-percent" value={pct(report.totals.marginPercent)} />
          </div>
          {report.itemsWithoutSheet > 0 && (
            <p role="note" data-testid="cost-without-sheet" className="text-xs text-warning bg-warning-bg border border-warning/30 rounded-xl px-4 py-3">{report.itemsWithoutSheet} item(ns) vendido(s) sem ficha técnica ficaram fora do custo e da margem. Cadastre a ficha em “Fichas técnicas”.</p>
          )}
          <div className="bg-card rounded-xl border border-border overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground uppercase tracking-wider"><th className="px-4 py-3">Item</th><th className="px-4 py-3">Categoria</th><th className="px-4 py-3 text-right">Qtd</th><th className="px-4 py-3 text-right">Receita</th><th className="px-4 py-3 text-right">Custo</th><th className="px-4 py-3 text-right">Margem</th><th className="px-4 py-3 text-right">%</th></tr></thead>
              <tbody>
                {report.rows.map(row => (
                  <tr key={row.menuItemId} data-testid="cost-row" className="border-t border-border text-sm">
                    <td className="px-4 py-3 font-medium text-foreground">{row.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.category}</td>
                    <td className="px-4 py-3 text-right">{row.quantity}</td>
                    <td className="px-4 py-3 text-right">{formatCents(row.revenueCents)}</td>
                    <td className="px-4 py-3 text-right">{row.costCents === null ? <span className="text-xs text-warning">sem ficha</span> : formatCents(row.costCents)}</td>
                    <td className="px-4 py-3 text-right">{row.marginCents === null ? '—' : formatCents(row.marginCents)}</td>
                    <td className="px-4 py-3 text-right font-medium">{pct(row.marginPercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Margem por categoria</p>
          <div className="bg-card rounded-xl border border-border overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <tbody>
                {report.categories.map(category => (
                  <tr key={category.category} data-testid="category-row" className="border-t first:border-t-0 border-border text-sm">
                    <td className="px-4 py-3 font-medium text-foreground">{category.category}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{category.quantity} un</td>
                    <td className="px-4 py-3 text-right">{formatCents(category.revenueCents)}</td>
                    <td className="px-4 py-3 text-right">{formatCents(category.costCents)}</td>
                    <td className="px-4 py-3 text-right">{formatCents(category.marginCents)}</td>
                    <td className="px-4 py-3 text-right font-medium">{pct(category.marginPercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Custo de cada item = custo atual da ficha técnica × quantidade vendida. Receita = valor cobrado pelos itens (promoções incluídas, antes de cupons e cashback do pedido). Considera pedidos pagos e não cancelados, pela data do pagamento.</p>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p data-testid={testId} className="font-display font-bold text-xl text-foreground mt-1">{value}</p>
    </div>
  );
}
