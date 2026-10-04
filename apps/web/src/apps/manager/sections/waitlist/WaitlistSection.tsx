import { useMemo, useState, type ReactNode } from 'react';
import { Bell, Check, ChevronDown, ChevronUp, Clock, Plus, Users, X } from 'lucide-react';
import { buildFloorUnits, unitLiveState, type FloorUnit } from '@/components/floor/floorUnits';
import { LIVE_STATUS_STYLE } from '@/components/floor/tableStyles';
import EmptyState from '@/components/ui/EmptyState';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useNow } from '@/lib/hooks';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatTime } from '@/lib/utils';
import { formatPhone } from '@/lib/validation';
import { useFloorLayout, useTableLiveStates } from '@/services/floorService';
import { moveInWaitlist, notifyParty, releaseTables, removeFromWaitlist, seatParty, useWaitlist } from '@/services/waitlistService';
import type { ManagerSectionProps } from '../../types';
import WaitlistEntryModal from './WaitlistEntryModal';

const MINUTE_MS = 60_000;

/**
 * Ficha 21: fila no servidor (posição, estimativa e aviso). Liberar uma mesa avisa
 * automaticamente o primeiro grupo que cabe nela; os outros aparelhos atualizam em tempo real.
 */
export default function WaitlistSection({ unit, notify }: ManagerSectionProps) {
  const waitlist = useWaitlist(unit.id);
  const { layout } = useFloorLayout(unit.id);
  const liveStates = useTableLiveStates(unit.id);
  const now = useNow(30_000);
  const { run } = useAsyncAction(notify);
  const [adding, setAdding] = useState(false);

  const floorUnits = useMemo(() => (layout ? buildFloorUnits(layout) : []), [layout]);

  if (waitlist.error) return <ErrorBlock error={waitlist.error} onRetry={() => void waitlist.refetch()} />;
  if (!waitlist.data) return <LoadingBlock />;

  const entries = waitlist.data.entries;
  const unitsWithState = floorUnits.map(floorUnit => ({ floorUnit, state: unitLiveState(floorUnit, liveStates) }));
  const freeUnits = unitsWithState.filter(u => u.state.status === 'free');
  const busyUnits = unitsWithState.filter(u => u.state.status !== 'free');
  const waiting = entries.filter(e => e.status === 'waiting');
  const longestEstimate = Math.max(0, ...waiting.map(e => e.estimatedWaitMinutes ?? 0));

  function release(floorUnit: FloorUnit) {
    void run(
      () => releaseTables(unit.id, floorUnit.tables.map(table => table.id)),
      notified => (notified ? `${floorUnit.label} liberada — ${notified.name} notificado` : `${floorUnit.label} liberada`),
    );
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Kpi icon={Users} tone="bg-primary/10 text-primary" label="Total na fila" value={`${entries.length} grupo${entries.length === 1 ? '' : 's'}`} />
        <Kpi icon={Clock} tone="bg-warning/10 text-warning" label="Espera estimada" value={waiting.length ? (longestEstimate === 0 ? 'Imediata' : `~${longestEstimate} min`) : '—'} />
        <Kpi icon={Check} tone="bg-success/10 text-success" label="Mesas livres agora" value={String(freeUnits.length)} />
      </div>

      <div className="flex flex-col xl:flex-row gap-6 items-start">
        <div className="flex-1 w-full bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <p className="font-semibold text-foreground">Fila de espera</p>
            <button onClick={() => setAdding(true)} className="flex items-center gap-2 bg-primary text-white px-3 py-1.5 rounded-lg text-sm font-medium">
              <Plus size={13} />
              Adicionar
            </button>
          </div>
          {entries.length === 0 ? (
            <EmptyState icon={Users} title="Ninguém na fila" description="Adicione grupos que chegarem sem mesa disponível." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {['Pos.', 'Cliente', 'Pessoas', 'Aguardando', 'Estimativa', 'Status', 'Ações'].map(header => (
                      <th key={header} className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, index) => {
                    const waitedMin = Math.max(0, Math.floor((now - Date.parse(entry.joinedAt)) / MINUTE_MS));
                    const estimate = entry.estimatedWaitMinutes;
                    return (
                      <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-muted/10">
                        <td className="px-4 py-3">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-xs font-bold text-primary">{index + 1}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-foreground">{entry.name}</p>
                          <p className="text-xs text-muted-foreground">{formatPhone(entry.phone)}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">{entry.partySize} pessoas</td>
                        <td className="px-4 py-3 text-sm text-foreground">{waitedMin} min</td>
                        <td className="px-4 py-3 text-sm text-foreground">{estimate === null ? '—' : estimate === 0 ? 'Mesa disponível' : `~${estimate} min`}</td>
                        <td className="px-4 py-3">
                          {entry.status === 'notified' ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/10 text-success whitespace-nowrap">
                              Notificado {entry.notifiedAt ? formatTime(entry.notifiedAt) : ''}
                              {entry.notifiedTableLabel ? ` · ${entry.notifiedTableLabel}` : ''}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-warning/10 text-warning">Aguardando</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <IconButton label={`Subir ${entry.name}`} disabled={index === 0} onClick={() => void run(() => moveInWaitlist(unit.id, entry.id, entry.position - 1))}>
                              <ChevronUp size={13} />
                            </IconButton>
                            <IconButton
                              label={`Descer ${entry.name}`}
                              disabled={index === entries.length - 1}
                              onClick={() => void run(() => moveInWaitlist(unit.id, entry.id, entry.position + 1))}
                            >
                              <ChevronDown size={13} />
                            </IconButton>
                            <button
                              onClick={() => void run(() => notifyParty(unit.id, entry.id), `${entry.name} notificado`)}
                              className="text-xs bg-primary text-white font-medium px-2.5 py-1 rounded-lg hover:bg-primary/90 flex items-center gap-1"
                            >
                              <Bell size={11} />
                              {entry.status === 'notified' ? 'Avisar de novo' : 'Notificar'}
                            </button>
                            <button
                              onClick={() => void run(() => seatParty(unit.id, entry.id), `${entry.name} acomodado`)}
                              className="text-xs bg-success/10 text-success font-medium px-2.5 py-1 rounded-lg hover:bg-success/20"
                            >
                              Sentar
                            </button>
                            <IconButton
                              label={`Remover ${entry.name} da fila`}
                              onClick={() => void run(() => removeFromWaitlist(unit.id, entry.id), `${entry.name} removido da fila`)}
                            >
                              <X size={13} />
                            </IconButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="w-full xl:w-72 bg-card border border-border rounded-xl overflow-hidden flex-shrink-0">
          <div className="px-4 py-3 border-b border-border">
            <p className="font-semibold text-foreground text-sm">Mesas ocupadas</p>
            <p className="text-xs text-muted-foreground mt-0.5">Ao liberar, o próximo grupo que cabe na mesa é notificado.</p>
          </div>
          {busyUnits.length === 0 ? (
            <p className="text-sm text-muted-foreground px-4 py-6 text-center">{floorUnits.length ? 'Todas as mesas estão livres.' : 'Planta do salão ainda não desenhada.'}</p>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto">
              {busyUnits.map(({ floorUnit, state }) => (
                <li key={floorUnit.key} className="px-4 py-3 border-b border-border last:border-0 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{floorUnit.label}</p>
                    <p className={cn('text-xs font-medium', LIVE_STATUS_STYLE[state.status].text)}>
                      {LIVE_STATUS_STYLE[state.status].label} · {floorUnit.capacity} lugares
                    </p>
                  </div>
                  <button onClick={() => release(floorUnit)} className="text-xs bg-success/10 text-success font-medium px-2.5 py-1 rounded-lg hover:bg-success/20 flex-shrink-0">
                    Liberar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {adding && <WaitlistEntryModal establishmentId={unit.id} notify={notify} onClose={() => setAdding(false)} />}
    </div>
  );
}

function Kpi({ icon: Icon, tone, label, value }: { icon: typeof Users; tone: string; label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', tone)}>
        <Icon size={16} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-display font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground disabled:opacity-30 disabled:hover:bg-transparent">
      {children}
    </button>
  );
}
