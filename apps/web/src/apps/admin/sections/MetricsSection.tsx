import { useState } from 'react';
import { Download } from 'lucide-react';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { addDays, brDay, isoDay, shortDay } from '@/lib/dates';
import { cn, formatCents } from '@/lib/utils';
import { metricsExportUrl, usePlatformMetrics, type MetricsFilter } from '@/services/sprint5Service';
import TrendChart from '../components/TrendChart';

const pct = (value: number | null) => (value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toLocaleString('pt-BR')}%`);
const PRESETS = [7, 30, 90] as const;

/** Ficha 41: métricas da plataforma por período, evolução diária, comparação com outro período e exportação. */
export default function MetricsSection() {
  const today = isoDay(new Date());
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [customCompare, setCustomCompare] = useState(false);
  const [compareFrom, setCompareFrom] = useState(addDays(today, -59));
  const [compareTo, setCompareTo] = useState(addDays(today, -30));
  const filter: MetricsFilter = { from, to, ...(customCompare && compareFrom <= compareTo && { compareFrom, compareTo }) };
  const query = usePlatformMetrics(filter);
  const invalid = !from || !to || from > to;
  const data = query.data;

  const points = (key: 'orders' | 'gmvCents' | 'activeUsers') =>
    (data?.current.series ?? []).map((point, index) => ({ label: shortDay(point.date), current: point[key], previous: data?.previous.series[index]?.[key] ?? null }));

  return (
    <div className="p-6 flex flex-col gap-5 max-w-6xl">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label htmlFor="metrics-from" className="text-xs text-muted-foreground font-medium block mb-1">De</label>
          <input id="metrics-from" type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} className="border border-border rounded-xl px-3 py-2 text-sm bg-card" />
        </div>
        <div>
          <label htmlFor="metrics-to" className="text-xs text-muted-foreground font-medium block mb-1">Até</label>
          <input id="metrics-to" type="date" value={to} min={from} onChange={event => setTo(event.target.value)} className="border border-border rounded-xl px-3 py-2 text-sm bg-card" />
        </div>
        <div className="flex gap-1">
          {PRESETS.map(days => (
            <button key={days} onClick={() => { setFrom(addDays(today, -(days - 1))); setTo(today); }} className="px-3 py-2 rounded-xl text-sm bg-muted text-muted-foreground hover:text-foreground">{days} dias</button>
          ))}
        </div>
        <div className="flex gap-2 ml-auto">
          {(['csv', 'pdf'] as const).map(format => (
            <a key={format} data-testid={`metrics-export-${format}`} aria-disabled={invalid} href={invalid ? undefined : metricsExportUrl(filter, format)} download className={cn('flex items-center gap-2 border border-border rounded-xl px-4 py-2 text-sm font-medium', invalid ? 'opacity-50 pointer-events-none' : 'hover:bg-muted')}>
              <Download size={14} />Exportar {format.toUpperCase()}
            </a>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-3 flex-wrap text-sm">
        <label className="flex items-center gap-2 text-muted-foreground"><input type="checkbox" checked={customCompare} onChange={event => setCustomCompare(event.target.checked)} />Comparar com outro período</label>
        {customCompare ? (
          <>
            <input aria-label="Comparar de" type="date" value={compareFrom} onChange={event => setCompareFrom(event.target.value)} className="border border-border rounded-xl px-3 py-1.5 text-sm bg-card" />
            <input aria-label="Comparar até" type="date" value={compareTo} onChange={event => setCompareTo(event.target.value)} className="border border-border rounded-xl px-3 py-1.5 text-sm bg-card" />
          </>
        ) : (
          data && <span className="text-xs text-muted-foreground">Comparando com o período anterior de mesmo tamanho ({brDay(data.previous.from)} a {brDay(data.previous.to)}).</span>
        )}
      </div>

      {invalid && <p className="text-sm text-error">A data inicial deve ser anterior à final.</p>}
      {query.error && !data && <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />}
      {!invalid && !data && !query.error && <LoadingBlock />}
      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([
              ['Pedidos', data.current.totals.orders.toLocaleString('pt-BR'), data.previous.totals.orders.toLocaleString('pt-BR'), data.change.orders, 'metric-orders'],
              ['GMV', formatCents(data.current.totals.gmvCents), formatCents(data.previous.totals.gmvCents), data.change.gmvCents, 'metric-gmv'],
              ['Usuários ativos', data.current.totals.activeUsers.toLocaleString('pt-BR'), data.previous.totals.activeUsers.toLocaleString('pt-BR'), data.change.activeUsers, 'metric-users'],
            ] as const).map(([label, value, previous, change, testId]) => (
              <div key={label} className="bg-card border border-border rounded-xl p-4" data-testid={testId}>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
                <p className="font-display text-2xl font-bold text-foreground">{value}</p>
                <p className="text-xs text-muted-foreground">
                  Anterior: {previous} · <span className={cn('font-medium', change === null ? '' : change >= 0 ? 'text-success' : 'text-error')}>{pct(change)}</span>
                </p>
              </div>
            ))}
          </div>
          <TrendChart title="Pedidos por dia" points={points('orders')} format={value => Math.round(value).toLocaleString('pt-BR')} testId="chart-orders" />
          <TrendChart title="GMV por dia" points={points('gmvCents')} format={value => formatCents(Math.round(value))} formatAxis={value => `R$ ${(value / 100).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })}`} testId="chart-gmv" />
          <TrendChart title="Usuários ativos por dia" points={points('activeUsers')} format={value => Math.round(value).toLocaleString('pt-BR')} testId="chart-users" />

          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Por estabelecimento (a soma bate com o total)</p>
            <div className="bg-card rounded-xl border border-border overflow-x-auto">
              <table className="w-full min-w-[480px]">
                <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground uppercase tracking-wider"><th className="px-4 py-3">Estabelecimento</th><th className="px-4 py-3 text-right">Pedidos</th><th className="px-4 py-3 text-right">GMV</th></tr></thead>
                <tbody>
                  {data.byEstablishment.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma venda no período.</td></tr>}
                  {data.byEstablishment.map(row => (
                    <tr key={row.id} data-testid="metrics-row" className="border-t border-border text-sm"><td className="px-4 py-2.5">{row.name}</td><td className="px-4 py-2.5 text-right tabular-nums">{row.orders}</td><td className="px-4 py-2.5 text-right tabular-nums">{formatCents(row.gmvCents)}</td></tr>
                  ))}
                  <tr className="border-t-2 border-border text-sm font-semibold bg-muted/30"><td className="px-4 py-2.5">Total</td><td className="px-4 py-2.5 text-right tabular-nums">{data.current.totals.orders}</td><td className="px-4 py-2.5 text-right tabular-nums">{formatCents(data.current.totals.gmvCents)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
