import { AlertTriangle, ArrowDownRight, ArrowUpRight, Building2, Network, Users } from 'lucide-react';
import { ESTABLISHMENT_PROBLEM_LABELS, percentChange, type DayMetrics } from '@filafacil/shared';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { cn, formatCents, formatDateTime } from '@/lib/utils';
import { usePlatformOverview } from '@/services/sprint5Service';
import { Pill, PlanPill } from '../components/Pills';

export type OverviewTarget = 'establishments' | 'organizations' | 'users' | 'metrics';

function Change({ current, previous }: { current: number; previous: number }) {
  const change = percentChange(current, previous);
  if (change === null) return <span className="text-xs text-muted-foreground">sem base ontem</span>;
  const up = change >= 0;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', up ? 'text-success' : 'text-error')}>
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {up ? '+' : ''}
      {change.toLocaleString('pt-BR')}% vs ontem
    </span>
  );
}

function Stat({ label, value, children, testId }: { label: string; value: string; children?: React.ReactNode; testId?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1" data-testid={testId}>
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-display text-2xl font-bold text-foreground">{value}</span>
      {children}
    </div>
  );
}

const metric = (today: DayMetrics, yesterday: DayMetrics, key: keyof DayMetrics) => ({ current: today[key], previous: yesterday[key] });

/** Ficha 32: visão geral do dia em todos os estabelecimentos ativos, comparada com ontem. */
export default function OverviewSection({ onNavigate }: { onNavigate: (target: OverviewTarget) => void }) {
  const overview = usePlatformOverview();
  if (overview.error && !overview.data) return <ErrorBlock error={overview.error} onRetry={() => void overview.refetch()} />;
  if (!overview.data) return <LoadingBlock />;
  const data = overview.data;
  const withProblems = data.establishments.filter(row => row.problems.length > 0).length;

  return (
    <div className="p-6 flex flex-col gap-5 max-w-6xl">
      <p className="text-sm text-muted-foreground">
        Hoje ({data.date.split('-').reverse().join('/')}) nos estabelecimentos ativos · atualizado {formatDateTime(data.generatedAt)}. Os totais são a soma das linhas da tabela.
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Estabelecimentos ativos" value={String(data.activeEstablishments)} testId="stat-active">
          <span className="text-xs text-muted-foreground">{data.suspendedEstablishments} suspenso(s) · {data.organizations} rede(s)</span>
        </Stat>
        <Stat label="Pedidos hoje" value={data.today.orders.toLocaleString('pt-BR')} testId="stat-orders">
          <Change {...metric(data.today, data.yesterday, 'orders')} />
        </Stat>
        <Stat label="GMV hoje" value={formatCents(data.today.gmvCents)} testId="stat-gmv">
          <Change {...metric(data.today, data.yesterday, 'gmvCents')} />
        </Stat>
        <Stat label="Usuários ativos hoje" value={data.today.activeUsers.toLocaleString('pt-BR')} testId="stat-users">
          <Change {...metric(data.today, data.yesterday, 'activeUsers')} />
        </Stat>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => onNavigate('establishments')} className="flex items-center gap-2 border border-border rounded-xl px-3 py-2 text-sm hover:bg-muted"><Building2 size={14} />Estabelecimentos</button>
        <button onClick={() => onNavigate('organizations')} className="flex items-center gap-2 border border-border rounded-xl px-3 py-2 text-sm hover:bg-muted"><Network size={14} />Organizações</button>
        <button onClick={() => onNavigate('users')} className="flex items-center gap-2 border border-border rounded-xl px-3 py-2 text-sm hover:bg-muted"><Users size={14} />Usuários</button>
        <button onClick={() => onNavigate('metrics')} className="flex items-center gap-2 border border-border rounded-xl px-3 py-2 text-sm hover:bg-muted"><ArrowUpRight size={14} />Métricas por período</button>
      </div>

      {withProblems > 0 && (
        <p role="status" className="flex items-center gap-2 text-sm text-warning bg-warning/10 border border-warning/30 rounded-xl px-4 py-3">
          <AlertTriangle size={15} />
          {withProblems} estabelecimento(s) com problema aparecem primeiro na lista.
        </p>
      )}

      <div className="bg-card rounded-xl border border-border overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead className="bg-muted/50">
            <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
              <th className="px-4 py-3">Estabelecimento</th><th className="px-4 py-3">Rede</th><th className="px-4 py-3 text-right">Pedidos (ontem)</th><th className="px-4 py-3 text-right">GMV (ontem)</th><th className="px-4 py-3">Situação</th>
            </tr>
          </thead>
          <tbody>
            {data.establishments.map(row => (
              <tr key={row.id} data-testid="overview-row" className="border-t border-border text-sm">
                <td className="px-4 py-3"><span className="font-medium text-foreground">{row.name}</span> <PlanPill name={row.planName} /></td>
                <td className="px-4 py-3 text-muted-foreground">{row.organizationName}</td>
                <td className="px-4 py-3 text-right tabular-nums">{row.today.orders} <span className="text-muted-foreground">({row.yesterday.orders})</span></td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCents(row.today.gmvCents)} <span className="text-muted-foreground">({formatCents(row.yesterday.gmvCents)})</span></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {row.problems.length === 0 ? <Pill className="bg-success/10 text-success">OK</Pill> : row.problems.map(problem => <Pill key={problem} className="bg-error/10 text-error">{ESTABLISHMENT_PROBLEM_LABELS[problem]}</Pill>)}
                  </div>
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-border text-sm font-semibold bg-muted/30">
              <td className="px-4 py-3" colSpan={2}>Total</td>
              <td className="px-4 py-3 text-right tabular-nums" data-testid="total-orders">{data.today.orders} <span className="text-muted-foreground font-normal">({data.yesterday.orders})</span></td>
              <td className="px-4 py-3 text-right tabular-nums" data-testid="total-gmv">{formatCents(data.today.gmvCents)} <span className="text-muted-foreground font-normal">({formatCents(data.yesterday.gmvCents)})</span></td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Usuários ativos hoje</p>
        <div className="bg-card rounded-xl border border-border divide-y divide-border">
          {data.activeUsers.length === 0 && <p className="px-4 py-6 text-sm text-center text-muted-foreground">Ninguém entrou ou pediu hoje ainda.</p>}
          {data.activeUsers.map(user => (
            <div key={user.id} data-testid="active-user" className="px-4 py-2.5 flex items-center justify-between text-sm">
              <span className="text-foreground">{user.name} <span className="text-xs text-muted-foreground">· {user.role}</span></span>
              <span className="text-xs text-muted-foreground">{user.lastAccessAt ? formatDateTime(user.lastAccessAt) : '—'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
