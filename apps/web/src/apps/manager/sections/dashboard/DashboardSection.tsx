import { AlertTriangle, ClipboardList, Receipt, Share2, Table2, Timer, Users, Wallet } from 'lucide-react';
import { SHARE_SOURCE_LABELS, type ShareSource } from '@filafacil/shared';
import type { ElementType } from 'react';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { formatCents, formatTime } from '@/lib/utils';
import { useDashboard } from '@/services/operationsService';
import { useShareVisits } from '@/services/sprint4StaffService';
import type { ManagerSectionProps } from '../../types';

/** Ficha 27: indicadores do dia — só dados reais da API (nada é estimado no navegador). */
export default function DashboardSection({ unit }: ManagerSectionProps) {
  const query = useDashboard(unit.id);
  const shares = useShareVisits(unit.id).data;
  if (query.error && !query.data) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingBlock />;
  const d = query.data;
  return (
    <div className="p-6 flex flex-col gap-4 max-w-5xl">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <Card icon={ClipboardList} label="Pedidos do dia" testId="kpi-orders" value={String(d.ordersCount)} />
        <Card icon={Wallet} label="Faturamento do dia" testId="kpi-revenue" value={formatCents(d.revenueCents)} />
        <Card icon={Receipt} label="Ticket médio" testId="kpi-ticket" value={formatCents(d.averageTicketCents)} />
        <Card icon={Table2} label="Mesas ocupadas" testId="kpi-tables" value={`${d.occupiedTables} de ${d.totalTables}`} />
        <Card icon={Users} label="Fila de espera" testId="kpi-waitlist" value={String(d.waitlistCount)} />
        <Card icon={d.lateOrders > 0 ? AlertTriangle : Timer} label="Pedidos atrasados" testId="kpi-late" value={String(d.lateOrders)} tone={d.lateOrders > 0 ? 'error' : undefined} />
      </div>
      {shares && (
        <div data-testid="share-visits" className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
          <p className="text-sm font-display font-semibold text-foreground flex items-center gap-2"><Share2 size={14} />Acessos pelo link compartilhado · últimos 30 dias</p>
          {shares.total === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum acesso ainda. Quando clientes compartilharem a página do restaurante, a origem aparece aqui.</p>
          ) : (
            <ul className="text-sm flex flex-col gap-1">
              <li className="flex justify-between font-medium"><span>Total</span><span data-testid="share-total">{shares.total}</span></li>
              {shares.bySource.map(row => <li key={row.source} className="flex justify-between text-muted-foreground"><span>{SHARE_SOURCE_LABELS[row.source as ShareSource] ?? row.source}</span><span>{row.count}</span></li>)}
            </ul>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Atualizado às {formatTime(d.generatedAt)} · dia em fuso do estabelecimento.</p>
    </div>
  );
}

function Card({ icon: Icon, label, value, testId, tone }: { icon: ElementType; label: string; value: string; testId: string; tone?: 'error' }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
      <Icon size={16} className={tone === 'error' ? 'text-error' : 'text-muted-foreground'} />
      <p className="text-xs text-muted-foreground">{label}</p>
      <p data-testid={testId} className={`font-display font-bold text-2xl ${tone === 'error' ? 'text-error' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}
