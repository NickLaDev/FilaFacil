import { useState } from 'react';
import { History, Play, Square } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { formatCents, formatDateTime, formatTime } from '@/lib/utils';
import { closeShift, openShift, useCurrentShift, useShiftHistory, useShifts } from '@/services/operationsService';
import type { ManagerSectionProps } from '../../types';
import ConfirmDialog from '../../components/ConfirmDialog';

/** Ficha 25: abrir/fechar turno e histórico (entregues e cancelados do período, com totais). */
export default function ShiftSection({ unit, notify }: ManagerSectionProps) {
  const current = useCurrentShift(unit.id);
  const shifts = useShifts(unit.id);
  const { run, pending } = useAsyncAction(notify);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const history = useShiftHistory(unit.id, selected);

  if (current.error && current.data === undefined) return <ErrorBlock error={current.error} onRetry={() => void current.refetch()} />;
  if (current.data === undefined || !shifts.data) return <LoadingBlock />;
  const open = current.data;

  return (
    <div className="p-6 flex flex-col gap-6 max-w-5xl">
      <div className="bg-card border border-border rounded-xl p-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Turno atual</p>
          <p data-testid="shift-state" className="font-display font-bold text-foreground text-lg">
            {open ? `Aberto desde ${formatDateTime(open.openedAt)}` : 'Nenhum turno aberto'}
          </p>
        </div>
        {open ? (
          <button disabled={pending} onClick={() => setConfirmClose(true)} className="flex items-center gap-2 bg-error text-white text-sm font-medium px-4 py-2.5 rounded-xl disabled:opacity-50"><Square size={14} />Fechar turno</button>
        ) : (
          <button disabled={pending} onClick={() => void run(() => openShift(unit.id), 'Turno aberto')} className="flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2.5 rounded-xl disabled:opacity-50"><Play size={14} />Abrir turno</button>
        )}
      </div>

      <section aria-label="Histórico de turnos" className="flex flex-col gap-3">
        <h2 className="font-display font-bold text-foreground flex items-center gap-2"><History size={16} />Histórico</h2>
        {shifts.data.items.length === 0 ? (
          <div className="bg-card border border-border rounded-xl"><EmptyState icon={History} title="Nenhum turno ainda" description="Os turnos abertos e fechados aparecem aqui." /></div>
        ) : (
          <ul className="bg-card border border-border rounded-xl divide-y divide-border">
            {shifts.data.items.map(shift => (
              <li key={shift.id}>
                <button onClick={() => setSelected(selected === shift.id ? null : shift.id)} aria-expanded={selected === shift.id} className="w-full px-4 py-3 flex items-center justify-between text-sm text-left hover:bg-muted/30">
                  <span>{formatDateTime(shift.openedAt)} → {shift.closedAt ? formatDateTime(shift.closedAt) : 'em andamento'}</span>
                  <span className="text-xs text-muted-foreground">{selected === shift.id ? 'Ocultar' : 'Ver pedidos'}</span>
                </button>
                {selected === shift.id && (
                  <div className="px-4 pb-4 flex flex-col gap-3">
                    {history.isPending || !history.data ? (
                      <LoadingBlock />
                    ) : (
                      <>
                        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <Totals label="Entregues" testId="shift-delivered" value={String(history.data.totals.deliveredCount)} />
                          <Totals label="Cancelados" testId="shift-cancelled" value={String(history.data.totals.cancelledCount)} />
                          <Totals label="Vendido (entregues)" testId="shift-delivered-cents" value={formatCents(history.data.totals.deliveredCents)} />
                          <Totals label="Estornado" testId="shift-refunded-cents" value={formatCents(history.data.totals.refundedCents)} />
                        </dl>
                        <ul className="text-sm divide-y divide-border border border-border rounded-lg">
                          {history.data.orders.length === 0 && <li className="px-3 py-2 text-muted-foreground">Nenhum pedido entregue ou cancelado neste turno.</li>}
                          {history.data.orders.map(order => (
                            <li key={order.id} className="px-3 py-2 flex justify-between gap-3">
                              <span>#{order.number} · {order.customerName} · {formatTime(order.updatedAt)}</span>
                              <span className={order.status === 'cancelled' ? 'text-error' : 'text-foreground'}>{order.status === 'cancelled' ? 'Cancelado' : 'Entregue'} · {formatCents(order.totalCents)}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {confirmClose && (
        <ConfirmDialog title="Fechar turno" message="O histórico do turno ficará disponível com os totais de pedidos entregues e cancelados." confirmLabel="Fechar turno" onConfirm={() => run(() => closeShift(unit.id), 'Turno fechado')} onClose={() => setConfirmClose(false)} />
      )}
    </div>
  );
}

function Totals({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="bg-muted/40 rounded-lg px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd data-testid={testId} className="font-display font-bold text-foreground">{value}</dd>
    </div>
  );
}
