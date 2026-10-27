import { useState } from 'react';
import { ChefHat, ClipboardList, Clock, MapPin, Undo2, XCircle } from 'lucide-react';
import { STAFF_ORDER_TRANSITIONS, type OrderSettlement, type OrderStatus, type QueueOrderDto } from '@filafacil/shared';
import EmptyState from '@/components/ui/EmptyState';
import { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatCents, formatTime } from '@/lib/utils';
import { advanceOrder, refundOrder } from '@/services/staffOrderService';
import { cancelOrderAsStaff, markStationReady, setOrderEstimate, useOrderQueue, useStations, type QueueStatusFilter } from '@/services/operationsService';

interface Props {
  establishmentId: string;
  canRefund: boolean;
  canEstimate: boolean;
  notify: (message: string) => void;
}

const STATUS_STYLE: Record<OrderStatus, { label: string; box: string }> = {
  received: { label: 'Aguardando pagamento', box: 'bg-muted text-muted-foreground' },
  paid: { label: 'Pago · novo', box: 'bg-primary/10 text-primary' },
  preparing: { label: 'Em preparo', box: 'bg-warning-bg text-warning' },
  ready: { label: 'Pronto', box: 'bg-success-bg text-success' },
  delivered: { label: 'Entregue', box: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'Cancelado', box: 'bg-error-bg text-error' },
};

const SETTLEMENT_LABEL: Partial<Record<OrderSettlement, string>> = {
  on_tab: 'Na comanda · pagamento pendente',
  settled_on_tab: 'Pago na comanda',
};

const NEXT_ACTION: Partial<Record<OrderStatus, string>> = {
  received: 'Iniciar preparo',
  paid: 'Iniciar preparo',
  preparing: 'Marcar como pronto',
  ready: 'Marcar como entregue',
};

/** Próximo status da equipe. Pedido de comanda (pagamento posterior) vai para o preparo ainda em `received`; sem comanda, nunca. */
function nextStatus(order: QueueOrderDto): OrderStatus | undefined {
  if (order.status === 'received') return order.tabId ? 'preparing' : undefined;
  return STAFF_ORDER_TRANSITIONS[order.status];
}

/** Pedido de comanda ainda `received` não está "aguardando pagamento": ou está na comanda, ou já foi quitado nela. */
function statusBadge(order: QueueOrderDto): { label: string; box: string } {
  if (order.status === 'received' && order.settlement === 'settled_on_tab') return { label: 'Pago na comanda', box: STATUS_STYLE.paid.box };
  if (order.status === 'received' && order.settlement === 'on_tab') return { label: 'Na comanda', box: 'bg-warning-bg text-warning' };
  return STATUS_STYLE[order.status];
}

const FILTERS: { id: QueueStatusFilter; label: string }[] = [
  { id: undefined, label: 'Todos' },
  { id: 'paid', label: 'Novos' },
  { id: 'preparing', label: 'Em preparo' },
  { id: 'ready', label: 'Prontos' },
];

/**
 * Fichas 23, 24, 63 e 10: fila FIFO com idade e atrasados, filtro por status e por estação, ajuste de tempo e
 * cancelamento. Atualiza em tempo real (`order.updated`) e por polling se o WebSocket cair.
 */
export default function OrdersSection({ establishmentId, canRefund, canEstimate, notify }: Props) {
  const [status, setStatus] = useState<QueueStatusFilter>(undefined);
  const [stationId, setStationId] = useState('');
  const query = useOrderQueue(establishmentId, status, stationId || undefined);
  const stations = useStations(establishmentId);
  const { run, pending } = useAsyncAction(notify);

  if (query.error && !query.data) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} className="flex-1 py-16" />;
  if (!query.data) return <LoadingBlock className="flex-1 py-16" />;

  const { items, counts, lateCount } = query.data;

  const advance = (order: QueueOrderDto) => {
    const next = nextStatus(order);
    if (next) void run(() => advanceOrder(establishmentId, order.id, next), `Pedido #${order.number}: ${STATUS_STYLE[next].label.toLowerCase()}`);
  };

  return (
    <div className="flex-1 overflow-auto p-5">
      <div className="flex flex-wrap items-center gap-2 mb-4 max-w-6xl">
        {FILTERS.map(filter => {
          const count = filter.id ? counts[filter.id] : counts.received + counts.paid + counts.preparing + counts.ready;
          return (
            <button
              key={filter.label}
              onClick={() => setStatus(filter.id)}
              aria-pressed={status === filter.id}
              className={cn('px-3 py-1.5 rounded-full text-xs font-medium border', status === filter.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-foreground')}
            >
              {filter.label} ({count})
            </button>
          );
        })}
        <span data-testid="late-count" className={cn('text-xs font-bold px-2.5 py-1 rounded-full', lateCount > 0 ? 'bg-error-bg text-error' : 'bg-muted text-muted-foreground')}>
          Atrasados: {lateCount}
        </span>
        <select aria-label="Filtrar por estação" value={stationId} onChange={e => setStationId(e.target.value)} className="ml-auto border border-border rounded-xl px-3 py-1.5 text-xs bg-card">
          <option value="">Todas as estações</option>
          {(stations.data ?? []).map(station => (
            <option key={station.id} value={station.id}>{station.name}</option>
          ))}
          <option value="general">Geral</option>
        </select>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Nenhum pedido na fila" description="Os pedidos pagos pelo app aparecem aqui assim que o pagamento é confirmado." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 max-w-6xl">
          {items.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              establishmentId={establishmentId}
              canRefund={canRefund}
              canEstimate={canEstimate}
              pending={pending}
              run={run}
              onAdvance={() => advance(order)}
              onRefund={() => void run(() => refundOrder(establishmentId, order.id), `Pedido #${order.number} estornado`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CardProps {
  order: QueueOrderDto;
  establishmentId: string;
  canRefund: boolean;
  canEstimate: boolean;
  pending: boolean;
  run: ReturnType<typeof useAsyncAction>['run'];
  onAdvance: () => void;
  onRefund: () => void;
}

function OrderCard({ order, establishmentId, canRefund, canEstimate, pending, run, onAdvance, onRefund }: CardProps) {
  const [minutes, setMinutes] = useState('');
  // Em `received` o selo de status já diz "Na comanda"/"Pago na comanda"; o chip só complementa os demais status.
  const settlementLabel = order.status === 'received' ? undefined : SETTLEMENT_LABEL[order.settlement];
  const badge = statusBadge(order);
  const canAdvance = nextStatus(order) !== undefined;
  const namedStations = [...new Map(order.items.filter(i => i.stationId).map(i => [i.stationId as string, i.stationName ?? 'Estação'])).entries()];
  const pendingStations = namedStations.filter(([id]) => order.items.some(i => i.stationId === id && !i.readyAt));
  const generalPending = order.items.some(i => !i.stationId && !i.readyAt);
  const hasStations = namedStations.length > 0;
  const estimate = Number.parseInt(minutes, 10);
  // Pedido já quitado na comanda não se cancela pela fila (a API responde ORDER_SETTLED_ON_TAB): procurar o atendimento.
  const cancelAllowed = order.settlement !== 'settled_on_tab' && (order.status === 'received' || (canRefund && (order.status === 'paid' || order.status === 'preparing' || order.status === 'ready')));

  return (
    <article className={cn('bg-card border rounded-xl p-4 flex flex-col gap-3', order.late ? 'border-error' : 'border-border')}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display font-bold text-foreground text-lg">#{order.number}</p>
          <p className="text-xs text-muted-foreground">{order.customerName} · {formatTime(order.createdAt)}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={cn('text-[11px] font-bold px-2.5 py-1 rounded-full', badge.box)}>{badge.label}</span>
          <span className="text-[11px] text-muted-foreground">Fila #{order.queuePosition}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1 text-muted-foreground"><Clock size={12} />{order.ageMinutes} min</span>
        {order.estimatedMinutes !== null && (
          <span className="text-muted-foreground">Estimativa: {order.estimatedMinutes} min{order.estimateAdjusted ? ' (ajustada)' : ''}</span>
        )}
        {order.late && <span className="bg-error-bg text-error font-bold px-2 py-0.5 rounded-full">Atrasado</span>}
        {settlementLabel && <span className="bg-warning-bg text-warning font-medium px-2 py-0.5 rounded-full">{settlementLabel}</span>}
      </div>
      {order.status === 'ready' && order.pickupCode && (
        <p className="text-xs text-muted-foreground">
          Código de retirada: <strong className="font-display text-foreground text-sm tracking-widest">{order.pickupCode}</strong>
        </p>
      )}
      {order.refundPending && <p className="text-xs text-warning font-medium">Estorno em confirmação com o banco — repita se necessário.</p>}
      {order.tableLabel && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><MapPin size={12} />{order.tableLabel}</p>}
      <ul className="text-sm flex flex-col gap-1">
        {order.items.map(item => (
          <li key={`${item.menuItemId}-${item.notes}`} className="flex justify-between gap-3">
            <span>{item.quantity}× {item.name}{item.notes && <span className="text-muted-foreground"> · {item.notes}</span>}</span>
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {item.stationName ?? 'Geral'}{item.readyAt ? ' ✓' : ''}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-border pt-2">
        <span className="text-xs text-muted-foreground">Total{order.discountCents > 0 ? ` (desconto ${formatCents(order.discountCents)})` : ''}</span>
        <span className="font-display font-bold text-foreground text-sm">{formatCents(order.totalCents)}</span>
      </div>

      {canEstimate && order.status !== 'received' && order.status !== 'ready' && (
        <div className="flex gap-2">
          <input
            aria-label={`Tempo estimado do pedido ${order.number} (min)`}
            type="number"
            min={1}
            max={240}
            placeholder="Ajustar tempo (min)"
            value={minutes}
            onChange={e => setMinutes(e.target.value)}
            className={cn(PANEL_INPUT_CLASS, 'py-1.5')}
          />
          <button
            disabled={pending || !(estimate >= 1 && estimate <= 240)}
            onClick={() => void run(async () => { await setOrderEstimate(establishmentId, order.id, estimate); setMinutes(''); }, `Pedido #${order.number}: tempo ajustado para ${estimate} min`)}
            className="px-3 border border-border rounded-xl text-xs font-medium disabled:opacity-50"
          >
            Ajustar
          </button>
        </div>
      )}

      {order.status === 'preparing' && hasStations && (
        <div className="flex flex-wrap gap-2">
          {pendingStations.map(([id, name]) => (
            <button
              key={id}
              disabled={pending}
              onClick={() => void run(() => markStationReady(establishmentId, order.id, id), `${name} pronta`)}
              className="text-xs font-medium border border-primary text-primary rounded-lg px-2.5 py-1.5 disabled:opacity-50"
            >
              {name} pronta
            </button>
          ))}
          {generalPending && (
            <button
              disabled={pending}
              onClick={() => void run(() => markStationReady(establishmentId, order.id, null), 'Geral pronta')}
              className="text-xs font-medium border border-primary text-primary rounded-lg px-2.5 py-1.5 disabled:opacity-50"
            >
              Geral pronta
            </button>
          )}
        </div>
      )}

      <div className="flex gap-2">
        {canAdvance && !(order.status === 'preparing' && pendingStations.length > 0) && (
          <button onClick={onAdvance} disabled={pending} className="flex-1 bg-primary text-primary-foreground text-sm font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50">
            <ChefHat size={15} />
            {NEXT_ACTION[order.status]}
          </button>
        )}
        {canRefund && (order.status === 'paid' || order.status === 'preparing' || (order.status === 'ready' && order.refundPending)) && (
          <button onClick={onRefund} disabled={pending} title="Estornar pagamento" aria-label={`Estornar pedido ${order.number}`} className="px-3 border border-error/30 text-error rounded-xl flex items-center justify-center disabled:opacity-50">
            <Undo2 size={15} />
          </button>
        )}
        {cancelAllowed && (
          <button
            onClick={() => void run(() => cancelOrderAsStaff(establishmentId, order.id), `Pedido #${order.number} cancelado`)}
            disabled={pending}
            title="Cancelar pedido"
            aria-label={`Cancelar pedido ${order.number}`}
            className="px-3 border border-error/30 text-error rounded-xl flex items-center justify-center disabled:opacity-50"
          >
            <XCircle size={15} />
          </button>
        )}
      </div>
    </article>
  );
}
