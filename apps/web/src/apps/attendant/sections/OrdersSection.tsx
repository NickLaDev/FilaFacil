import { ChefHat, ClipboardList, MapPin, Undo2 } from 'lucide-react';
import { STAFF_ORDER_TRANSITIONS, type OrderStatus, type StaffOrderDto } from '@filafacil/shared';
import EmptyState from '@/components/ui/EmptyState';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatCents, formatTime } from '@/lib/utils';
import { advanceOrder, refundOrder, useStaffOrders } from '@/services/staffOrderService';

interface Props {
  establishmentId: string;
  canRefund: boolean;
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

const NEXT_ACTION: Partial<Record<OrderStatus, string>> = {
  paid: 'Iniciar preparo',
  preparing: 'Marcar como pronto',
  ready: 'Marcar como entregue',
};

/**
 * Ficha 09: fila de pedidos pagos. Cada avanço de status vai ao servidor e chega ao cliente em segundos.
 * O estorno só aparece para quem tem a permissão específica.
 */
export default function OrdersSection({ establishmentId, canRefund, notify }: Props) {
  const query = useStaffOrders(establishmentId);
  const { run, pending } = useAsyncAction(notify);

  if (query.error) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} className="flex-1 py-16" />;
  if (!query.data) return <LoadingBlock className="flex-1 py-16" />;

  const orders = query.data.items;
  if (orders.length === 0) {
    return (
      <div className="flex-1 overflow-auto">
        <EmptyState icon={ClipboardList} title="Nenhum pedido em andamento" description="Os pedidos pagos pelo app aparecem aqui assim que o pagamento é confirmado." />
      </div>
    );
  }

  const advance = (order: StaffOrderDto) => {
    const next = STAFF_ORDER_TRANSITIONS[order.status];
    if (next) void run(() => advanceOrder(establishmentId, order.id, next), `Pedido #${order.number}: ${STATUS_STYLE[next].label.toLowerCase()}`);
  };
  const refund = (order: StaffOrderDto) => void run(() => refundOrder(establishmentId, order.id), `Pedido #${order.number} estornado`);

  return (
    <div className="flex-1 overflow-auto p-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 max-w-6xl">
        {orders.map(order => (
          <article key={order.id} className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-display font-bold text-foreground text-lg">#{order.number}</p>
                <p className="text-xs text-muted-foreground">{order.customerName} · {formatTime(order.createdAt)}</p>
              </div>
              <span className={cn('text-[11px] font-bold px-2.5 py-1 rounded-full', STATUS_STYLE[order.status].box)}>{STATUS_STYLE[order.status].label}</span>
            </div>
            {order.status === 'ready' && order.pickupCode && (
              <p className="text-xs text-muted-foreground">
                Código de retirada: <strong className="font-display text-foreground text-sm tracking-widest">{order.pickupCode}</strong>
              </p>
            )}
            {order.refundPending && <p className="text-xs text-warning font-medium">Estorno em confirmação com o banco — repita se necessário.</p>}
            {order.tableLabel && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5"><MapPin size={12} />{order.tableLabel}</p>
            )}
            <ul className="text-sm flex flex-col gap-1">
              {order.items.map(item => (
                <li key={`${item.menuItemId}-${item.notes}`} className="flex justify-between gap-3">
                  <span>{item.quantity}× {item.name}{item.notes && <span className="text-muted-foreground"> · {item.notes}</span>}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-xs text-muted-foreground">Total</span>
              <span className="font-display font-bold text-foreground text-sm">{formatCents(order.totalCents)}</span>
            </div>
            <div className="flex gap-2">
              {NEXT_ACTION[order.status] && (
                <button
                  onClick={() => advance(order)}
                  disabled={pending}
                  className="flex-1 bg-primary text-primary-foreground text-sm font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <ChefHat size={15} />
                  {NEXT_ACTION[order.status]}
                </button>
              )}
              {canRefund && (order.status === 'paid' || order.status === 'preparing' || (order.status === 'ready' && order.refundPending)) && (
                <button
                  onClick={() => refund(order)}
                  disabled={pending}
                  title="Estornar pagamento"
                  aria-label={`Estornar pedido ${order.number}`}
                  className="px-3 border border-error/30 text-error rounded-xl flex items-center justify-center disabled:opacity-50"
                >
                  <Undo2 size={15} />
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
