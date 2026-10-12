import { useMemo, useState } from 'react';
import { BellRing, ChevronRight, Map as MapIcon, Users } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import FloorCanvas, { MergeBlock, TableNode } from '@/components/floor/FloorCanvas';
import { buildFloorUnits, type FloorUnit } from '@/components/floor/floorUnits';
import { LIVE_STATUS_STYLE, shortTableLabel } from '@/components/floor/tableStyles';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatCurrency, formatTime } from '@/lib/utils';
import { cancelReservation, occupyTable, releaseTable, reserveTable, resolveTableCall, useTableCheck, useTableMap } from '@/services/floorService';
import type { TableLiveState, TableLiveStatus } from '@/types/floor';

const LEGEND_ORDER: TableLiveStatus[] = ['free', 'occupied', 'reserved', 'called'];

/**
 * Ficha 16: grade visual por status, atualizada em tempo real pelo servidor (pedido, chamado, pagamento,
 * reserva, mesclagem). Mesas mescladas (ficha 47) aparecem como uma unidade só.
 */
export default function FloorMapSection({ establishmentId, notify }: { establishmentId: string; notify: (message: string) => void }) {
  const { data: map, error, refetch } = useTableMap(establishmentId);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const units = useMemo(() => (map ? buildFloorUnits(map) : []), [map]);
  const selected = units.find(u => u.key === selectedKey) ?? null;
  const tableCount = map?.tables.length ?? 0;

  // Conta por unidade atendida: mesas mescladas entram uma vez, com o status do grupo.
  const counts = LEGEND_ORDER.reduce<Record<TableLiveStatus, number>>(
    (acc, status) => ({ ...acc, [status]: units.filter(unit => unit.state.status === status).length }),
    { free: 0, occupied: 0, reserved: 0, called: 0 },
  );

  if (error && !map) return <ErrorBlock error={error} onRetry={() => void refetch()} className="flex-1 py-16" />;
  if (!map) return <LoadingBlock className="flex-1 py-16" />;

  if (tableCount === 0) {
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
          {units.length} {units.length === tableCount ? 'mesas' : `unidades (${tableCount} mesas)`}
        </span>
        {LEGEND_ORDER.map(status => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={cn('w-2 h-2 rounded-full', LIVE_STATUS_STYLE[status].dot)} />
            <span className={cn('text-xs font-medium', status === 'called' && counts.called > 0 ? 'text-error font-bold' : 'text-foreground')}>
              {counts[status]} {LIVE_STATUS_STYLE[status].label.toLowerCase()}
            </span>
          </div>
        ))}
        {error && <span className="text-xs text-warning ml-auto">Sem atualização em tempo real — tentando reconectar…</span>}
      </div>

      <div className="flex-1 overflow-auto flex flex-col lg:flex-row">
        <div className="flex-1 p-5 min-w-0">
          <FloorCanvas onBackgroundClick={() => setSelectedKey(null)}>
            {units.map(unit => {
              const { state } = unit;
              const style = LIVE_STATUS_STYLE[state.status];
              const isSelected = unit.key === selectedKey;
              const toggle = () => setSelectedKey(isSelected ? null : unit.key);
              const content = <UnitContent label={unit.groupId ? unit.label.replace('Mesas ', '') : shortTableLabel(unit.label)} state={state} />;
              return unit.groupId ? (
                <MergeBlock
                  key={unit.key}
                  members={unit.tables}
                  variant="unit"
                  toneClassName={style.tone}
                  selected={isSelected}
                  highlight={Boolean(state.pendingCall)}
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
                  highlight={Boolean(state.pendingCall)}
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

        {selected && <UnitDetailPanel establishmentId={establishmentId} unit={selected} notify={notify} onClose={() => setSelectedKey(null)} />}
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

function UnitDetailPanel({ establishmentId, unit, notify, onClose }: { establishmentId: string; unit: FloorUnit; notify: (message: string) => void; onClose: () => void }) {
  const { state } = unit;
  const style = LIVE_STATUS_STYLE[state.status];
  const { run, pending } = useAsyncAction(notify);
  const [partySize, setPartySize] = useState('2');
  const [reservation, setReservation] = useState({ name: '', partySize: '2' });
  const check = useTableCheck(establishmentId, state.status === 'free' ? null : unit.actionTableId);
  const party = Number.parseInt(partySize, 10);
  const partyValid = Number.isFinite(party) && party >= 1 && party <= unit.capacity;
  const reservationParty = Number.parseInt(reservation.partySize, 10);
  const reservationValid = reservation.name.trim().length > 0 && Number.isFinite(reservationParty) && reservationParty >= 1 && reservationParty <= unit.capacity;
  const id = unit.actionTableId;

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

        {state.pendingCall && (
          <div className="bg-error-bg rounded-lg px-3 py-2 flex flex-col gap-2">
            <p className="text-xs text-error font-medium flex items-center gap-1.5">
              <BellRing size={12} />
              Chamado pendente desde {formatTime(Date.parse(state.pendingCall.createdAt))}.
            </p>
            <button
              disabled={pending}
              onClick={() => void run(() => resolveTableCall(establishmentId, id), 'Chamado atendido')}
              className="bg-error text-white text-xs font-semibold rounded-lg py-2 disabled:opacity-50"
            >
              Marcar como atendido
            </button>
          </div>
        )}

        {state.reservation && (
          <div className="bg-muted rounded-lg px-3 py-2 text-xs text-foreground flex flex-col gap-1">
            <p className="font-medium">
              Reserva: {state.reservation.name} · {state.reservation.partySize} pessoa{state.reservation.partySize === 1 ? '' : 's'}
            </p>
            <p className="text-muted-foreground">{formatTime(Date.parse(state.reservation.reservedAt))}</p>
            <button
              disabled={pending}
              onClick={() => void run(() => cancelReservation(establishmentId, id, state.reservation!.id), 'Reserva cancelada')}
              className="text-error font-medium text-left disabled:opacity-50"
            >
              Cancelar reserva
            </button>
          </div>
        )}

        {state.status !== 'occupied' && state.people === 0 && (
          <div className="flex flex-col gap-2 pt-1">
            <FormField label="Pessoas na mesa" htmlFor="occupy-party" error={partyValid ? undefined : `Entre 1 e ${unit.capacity}.`}>
              <input id="occupy-party" type="number" min={1} max={unit.capacity} value={partySize} onChange={e => setPartySize(e.target.value)} className={PANEL_INPUT_CLASS} />
            </FormField>
            <button
              disabled={pending || !partyValid}
              onClick={() => void run(() => occupyTable(establishmentId, id, party), `${unit.label} ocupada`)}
              className="bg-primary text-primary-foreground text-sm font-semibold rounded-xl py-2.5 disabled:opacity-50"
            >
              Ocupar mesa
            </button>
          </div>
        )}

        {(state.status === 'occupied' || state.people > 0) && (
          <button
            disabled={pending}
            onClick={() => void run(() => releaseTable(establishmentId, id), `${unit.label} liberada`)}
            className="bg-success/10 text-success text-sm font-semibold rounded-xl py-2.5 hover:bg-success/20 disabled:opacity-50"
          >
            Liberar mesa
          </button>
        )}

        {!state.reservation && state.status !== 'occupied' && state.people === 0 && (
          <div className="flex flex-col gap-2 pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Reservar</p>
            <input aria-label="Nome da reserva" placeholder="Nome" maxLength={60} value={reservation.name} onChange={e => setReservation(prev => ({ ...prev, name: e.target.value }))} className={PANEL_INPUT_CLASS} />
            <input aria-label="Pessoas na reserva" type="number" min={1} max={unit.capacity} value={reservation.partySize} onChange={e => setReservation(prev => ({ ...prev, partySize: e.target.value }))} className={PANEL_INPUT_CLASS} />
            <button
              disabled={pending || !reservationValid}
              onClick={() =>
                void run(async () => {
                  await reserveTable(establishmentId, id, { name: reservation.name.trim(), partySize: reservationParty });
                  setReservation({ name: '', partySize: '2' });
                }, `${unit.label} reservada`)
              }
              className="border border-border text-foreground text-sm font-medium rounded-xl py-2.5 hover:bg-muted disabled:opacity-50"
            >
              Reservar mesa
            </button>
          </div>
        )}

        {check.data && check.data.orders.length > 0 && (
          <div className="pt-3 border-t border-border text-sm">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Comanda</p>
            {check.data.orders.map(order => (
              <div key={order.id} className="flex items-center justify-between py-0.5">
                <span className="text-foreground">Pedido #{order.number}</span>
                <span className="text-muted-foreground">{formatCurrency(order.totalCents / 100)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1 font-medium">
              <span>Total</span>
              <span>{formatCurrency(check.data.totalCents / 100)}</span>
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{unit.groupId ? 'Mesas mescladas' : 'QR Code'}</p>
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
