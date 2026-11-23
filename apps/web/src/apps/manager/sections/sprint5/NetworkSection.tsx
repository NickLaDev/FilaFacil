import { useState } from 'react';
import { Network } from 'lucide-react';
import { ORGANIZATION_ROLE_LABELS } from '@filafacil/shared';
import EmptyState from '@/components/ui/EmptyState';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { addDays, isoDay } from '@/lib/dates';
import { cn, formatCents } from '@/lib/utils';
import { useMyOrganizations, useOrganizationReport } from '@/services/sprint5Service';
import type { ManagerSectionProps } from '../../types';

/** Ficha 35 (lado da rede): relatório consolidado das unidades e atalho para abrir cada uma. */
export default function NetworkSection({ onOpenUnit }: ManagerSectionProps & { onOpenUnit: (id: string) => void }) {
  const orgs = useMyOrganizations();
  const [selected, setSelected] = useState<string | null>(null);
  const today = isoDay(new Date());
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const activeId = selected ?? orgs.data?.[0]?.id ?? null;
  const report = useOrganizationReport(activeId, from, to);

  if (orgs.error && !orgs.data) return <ErrorBlock error={orgs.error} onRetry={() => void orgs.refetch()} />;
  if (!orgs.data) return <LoadingBlock />;
  if (orgs.data.length === 0) return <div className="p-6"><EmptyState icon={Network} title="Você não tem papel em nenhuma rede" description="O administrador da plataforma define quem vê o relatório consolidado de uma rede com várias unidades." /></div>;
  const role = orgs.data.find(org => org.id === activeId)?.role;

  return (
    <div className="p-6 flex flex-col gap-4 max-w-5xl">
      <div className="flex items-end gap-3 flex-wrap">
        {orgs.data.length > 1 && (
          <select aria-label="Rede" value={activeId ?? ''} onChange={event => setSelected(event.target.value)} className="border border-border rounded-xl px-3 py-2 text-sm bg-card">
            {orgs.data.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select>
        )}
        <input aria-label="De" type="date" value={from} onChange={event => setFrom(event.target.value)} className="border border-border rounded-xl px-3 py-2 text-sm bg-card" />
        <input aria-label="Até" type="date" value={to} onChange={event => setTo(event.target.value)} className="border border-border rounded-xl px-3 py-2 text-sm bg-card" />
        {role && <span className="text-xs text-muted-foreground ml-auto">Seu papel: {ORGANIZATION_ROLE_LABELS[role]}</span>}
      </div>
      {!report.data ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-card border border-border rounded-xl p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">Pedidos</p><p className="font-display text-2xl font-bold">{report.data.totals.orders}</p></div>
            <div className="bg-card border border-border rounded-xl p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">Faturamento</p><p className="font-display text-2xl font-bold">{formatCents(report.data.totals.gmvCents)}</p></div>
            <div className="bg-card border border-border rounded-xl p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">Ticket médio</p><p className="font-display text-2xl font-bold">{formatCents(report.data.totals.averageTicketCents)}</p></div>
          </div>
          <div className="bg-card rounded-xl border border-border overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground uppercase tracking-wider"><th className="px-4 py-3">Unidade</th><th className="px-4 py-3 text-right">Pedidos</th><th className="px-4 py-3 text-right">Faturamento</th><th className="px-4 py-3 text-right">Ticket</th><th /></tr></thead>
              <tbody>
                {report.data.units.map(unit => (
                  <tr key={unit.id} data-testid="network-unit" className="border-t border-border text-sm">
                    <td className="px-4 py-2.5 font-medium">{unit.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{unit.orders}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(unit.gmvCents)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(unit.averageTicketCents)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button disabled={role !== 'admin'} title={role !== 'admin' ? 'Visualizadores só veem o relatório' : undefined} onClick={() => onOpenUnit(unit.id)} className={cn('text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline')}>Abrir unidade</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
