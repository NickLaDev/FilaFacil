import { useMemo, useState } from 'react';
import { ChevronRight, Map as MapIcon, Users } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import FloorCanvas, { MergeBlock, TableNode } from '@/components/floor/FloorCanvas';
import { buildFloorUnits, unitLiveState, type FloorUnit } from '@/components/floor/floorUnits';
import { LIVE_STATUS_STYLE, shortTableLabel } from '@/components/floor/tableStyles';
import { cn, formatTime } from '@/lib/utils';
import { useFloorLayout, useTableLiveStates } from '@/services/floorService';
import type { TableLiveState, TableLiveStatus } from '@/types/floor';

const LEGEND_ORDER: TableLiveStatus[] = ['free', 'occupied', 'reserved', 'called'];

/**
 * Ficha 16 (Sprint 2): grade visual por status. A planta vem do servidor — a mesma salva pelo
 * gestor (ficha 20) —, então uma mesa reposicionada aparece aqui sem reconfiguração.
 */
export default function FloorMapSection({ establishmentId }: { establishmentId: string }) {
  const { layout, error, refetch } = useFloorLayout(establishmentId);
  const liveStates = useTableLiveStates(establishmentId);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const units = useMemo(() => (layout ? buildFloorUnits(layout) : []), [layout]);
  const selected = units.find(u => u.key === selectedKey) ?? null;

  // Conta por unidade atendida: mesas mescladas entram uma vez, com o status do grupo.
  const counts = LEGEND_ORDER.reduce<Record<TableLiveStatus, number>>(
    (acc, status) => ({ ...acc, [status]: units.filter(unit => unitLiveState(unit, liveStates).status === status).length }),
    { free: 0, occupied: 0, reserved: 0, called: 0 },
  );

  if (error) return <ErrorBlock error={error} onRetry={() => void refetch()} className="flex-1 py-16" />;
  if (!layout) return <LoadingBlock className="flex-1 py-16" />;

  if (layout.tables.length === 0) {
    return (
      <div className="flex-1 overflow-auto">
        <EmptyState icon={MapIcon} title="Planta ainda não configurada" description="O gestor precisa desenhar a planta do salão para o mapa de mesas aparecer aqui." />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="px-5 pt-4 pb-3 flex items-center gap-4 border-b border-border flex-shrink-0 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium">
          {units.length} {units.length === layout.tables.length ? 'mesas' : `unidades (${layout.tables.length} mesas)`}
        </span>
        {LEGEND_ORDER.map(status => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={cn('w-2 h-2 rounded-full', LIVE_STATUS_STYLE[status].dot)} />
            <span className={cn('text-xs font-medium', status === 'called' && counts.called > 0 ? 'text-error font-bold' : 'text-foreground')}>
              {counts[status]} {LIVE_STATUS_STYLE[status].label.toLowerCase()}
            </span>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-auto flex flex-col lg:flex-row">
        <div className="flex-1 p-5 min-w-0">
          <FloorCanvas onBackgroundClick={() => setSelectedKey(null)}>
            {units.map(unit => {
              const state = unitLiveState(unit, liveStates);
              const style = LIVE_STATUS_STYLE[state.status];
              const isSelected = unit.key === selectedKey;
              const toggle = () => setSelectedKey(isSelected ? null : unit.key);
              const content = <UnitContent label={unit.merge ? unit.label.replace('Mesas ', '') : shortTableLabel(unit.label)} state={state} />;
              return unit.merge ? (
                <MergeBlock
                  key={unit.key}
                  members={unit.tables}
                  variant="unit"
                  toneClassName={style.tone}
                  selected={isSelected}
                  highlight={state.status === 'called'}
                  ariaLabel={`${unit.label}: ${style.label}`}
                  onClick={toggle}
                >
                  {content}
                </MergeBlock>
              ) : (
                <TableNode
                  key={unit.key}
                  table={unit.tables[0]}
                  toneClassName={style.tone}
                  selected={isSelected}
                  highlight={state.status === 'called'}
                  ariaLabel={`${unit.label}: ${style.label}`}
                  onClick={toggle}
                >
                  {content}
                </TableNode>
              );
            })}
          </FloorCanvas>
          <p className="text-xs text-muted-foreground mt-3">
            Posições conforme a planta do salão definida pelo gestor. Mesas com chamado pendente piscam em vermelho.
          </p>
        </div>

        {selected && <UnitDetailPanel unit={selected} state={unitLiveState(selected, liveStates)} onClose={() => setSelectedKey(null)} />}
      </div>
    </div>
  );
}

function UnitContent({ label, state }: { label: string; state: TableLiveState }) {
  return (
    <>
      <span className="font-display font-bold text-xs">{label}</span>
      <span className="text-[10px] opacity-80">{LIVE_STATUS_STYLE[state.status].label}</span>
      {state.people > 0 && (
        <span className="flex items-center gap-0.5 opacity-70">
          <Users size={9} />
          <span className="text-[9px]">{state.people}</span>
        </span>
      )}
    </>
  );
}

function UnitDetailPanel({ unit, state, onClose }: { unit: FloorUnit; state: TableLiveState; onClose: () => void }) {
  const style = LIVE_STATUS_STYLE[state.status];
  const rows = [
    { label: 'Pessoas', value: state.people > 0 ? String(state.people) : '—' },
    { label: 'Capacidade', value: `${unit.capacity} lugares` },
    { label: 'Desde', value: state.since && state.status !== 'free' ? formatTime(Date.parse(state.since)) : '—' },
  ];
  return (
    <aside className="lg:w-72 border-t lg:border-t-0 lg:border-l border-border bg-card flex flex-col flex-shrink-0">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="font-display font-bold text-foreground">{unit.label}</h3>
          <span className={cn('text-xs font-medium', style.text)}>{style.label}</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" aria-label="Fechar detalhes">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="p-4 flex flex-col gap-3">
        {rows.map(row => (
          <div key={row.label} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-medium text-foreground">{row.value}</span>
          </div>
        ))}
        {state.status === 'called' && (
          <p className="text-xs text-error bg-error-bg rounded-lg px-3 py-2 font-medium">Chamado pendente nesta mesa.</p>
        )}
        <div className="pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{unit.merge ? 'Mesas mescladas' : 'QR Code'}</p>
          {unit.tables.map(table => (
            <div key={table.id} className="flex items-center justify-between text-sm py-1">
              <span className="text-foreground">{table.label}</span>
              <span className="font-mono text-xs text-muted-foreground">{table.qrCode}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
