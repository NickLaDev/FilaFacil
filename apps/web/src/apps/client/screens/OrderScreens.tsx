import { CheckCircle2, ChevronRight, Circle, Clock, MapPin, Receipt, Share2, ShoppingBag } from 'lucide-react';
import { cn, formatCurrency, formatDateTime } from '@/lib/utils';
import EmptyState from '@/components/ui/EmptyState';
import { ORDER_STEPS, getEstimatedTime, useOrder } from '@/services/orderService';
import type { OrderStatus } from '@/types/order';
import { useClient } from '../clientContext';
import { useClientOrders } from '../hooks/useOrders';
import { ScreenHeader } from '../components/Layout';
import { PAYMENT_METHOD_LABELS } from '../format';

const STATUS_LABEL: Record<OrderStatus, string> = Object.fromEntries(ORDER_STEPS.map(step => [step.status, step.label])) as Record<OrderStatus, string>;

/** Histórico com comprovantes e pedido em andamento (fichas 04 e 09). */
export function OrdersScreen() {
  const { go, account, openOrder, table } = useClient();
  const { orders } = useClientOrders();

  return (
    <div className="min-h-screen bg-background flex flex-col pb-24">
      <ScreenHeader title="Pedidos" />
      {!account ? (
        <EmptyState
          icon={ShoppingBag}
          title="Entre para ver seus pedidos"
          description="Seus pedidos e comprovantes ficam salvos na sua conta."
          action={<button onClick={() => go('login')} className="bg-primary text-primary-foreground px-6 py-3 rounded-xl font-medium mt-2">Entrar</button>}
        />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="Nenhum pedido ainda"
          description="Escaneie o QR Code da mesa para fazer seu primeiro pedido."
          action={<button onClick={() => go(table ? 'menu' : 'qr-scanner')} className="bg-primary text-primary-foreground px-6 py-3 rounded-xl font-medium mt-2">{table ? 'Ver cardápio' : 'Escanear QR Code'}</button>}
        />
      ) : (
        <div className="px-4 py-4 flex flex-col gap-3">
          {orders.map(({ order, status }) => {
            const delivered = status === 'delivered';
            return (
              <button
                key={order.id}
                onClick={() => openOrder(order.id, delivered ? 'receipt' : 'order-tracking')}
                className={cn('w-full bg-card border rounded-xl p-4 text-left flex items-center gap-3', delivered ? 'border-border' : 'border-2 border-primary/25')}
              >
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', delivered ? 'bg-muted' : 'bg-primary/10')}>
                  {delivered ? <Receipt size={18} className="text-muted-foreground" /> : <Clock size={18} className="text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-display font-semibold text-foreground text-sm">Pedido #{order.number}</p>
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', delivered ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary')}>
                      {STATUS_LABEL[status]}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{order.establishmentName} · {formatDateTime(order.createdAt)}</p>
                  <p className="text-xs text-foreground font-medium mt-0.5">{formatCurrency(order.total)}</p>
                </div>
                <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Linha do tempo atualizada sem recarregar a página (ficha 09). */
export function OrderTrackingScreen() {
  const { go, orderId, openOrder } = useClient();
  const { orders, active } = useClientOrders();
  // Sem pedido selecionado, acompanha o pedido em andamento mais recente.
  const current = orders.find(entry => entry.order.id === orderId) ?? active;

  if (!current) {
    return (
      <div className="min-h-screen bg-background flex flex-col pb-24">
        <ScreenHeader title="Acompanhar pedido" onBack={() => go('orders')} />
        <EmptyState icon={ShoppingBag} title="Nenhum pedido em andamento" />
      </div>
    );
  }

  const { order, status } = current;
  const currentIndex = ORDER_STEPS.findIndex(step => step.status === status);
  const isReady = status === 'ready';
  const estimate = getEstimatedTime(status);

  return (
    <div className={cn('min-h-screen flex flex-col transition-colors duration-700 pb-24', isReady ? 'bg-success-bg' : 'bg-background')}>
      <ScreenHeader title="Acompanhar pedido" onBack={() => go('orders')} className={isReady ? 'bg-success-bg border-success/20' : undefined} />

      {isReady ? (
        <div className="px-5 pt-8 pb-4 text-center flex flex-col items-center gap-4" aria-live="polite">
          <div className="text-5xl" aria-hidden="true">🎉</div>
          <div>
            <p className="font-display font-bold text-success text-2xl">Seu pedido está pronto!</p>
            <p className="text-success/80 font-medium mt-1">Retire no {order.pickupPoint}</p>
          </div>
          <div className="bg-white rounded-2xl w-full py-6 border border-success/20">
            <p className="text-muted-foreground text-sm">Número do pedido</p>
            <p className="font-display font-bold text-foreground" style={{ fontSize: '72px', lineHeight: 1 }}>#{order.number}</p>
          </div>
          <div className="bg-primary/10 border border-primary/30 rounded-2xl w-full py-5 px-4 flex flex-col items-center gap-1">
            <p className="text-xs font-semibold text-primary uppercase tracking-widest">Código de retirada</p>
            <p className="font-display font-black text-primary" style={{ fontSize: '56px', lineHeight: 1, letterSpacing: '0.12em' }}>{order.pickupCode}</p>
            <p className="text-xs text-muted-foreground text-center mt-1">Informe este código no balcão para retirar seu pedido</p>
          </div>
        </div>
      ) : (
        <div className="px-5 pt-6 pb-2 text-center" aria-live="polite">
          <p className="text-muted-foreground text-sm">Pedido</p>
          <p className="font-display font-bold text-foreground text-4xl">#{order.number}</p>
          <div className="flex justify-center gap-4 mt-3 flex-wrap">
            {estimate && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground"><Clock size={13} /><span>{estimate}</span></div>
            )}
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin size={13} /><span>Retirada: {order.pickupPoint}</span></div>
          </div>
          {order.tableLabel && <p className="text-xs text-muted-foreground mt-2">{order.establishmentName} · {order.tableLabel}</p>}
        </div>
      )}

      <div className="px-5 py-4 flex flex-col gap-1">
        {ORDER_STEPS.map((step, index) => {
          const done = index < currentIndex || status === 'delivered';
          const isCurrent = index === currentIndex && status !== 'delivered';
          return (
            <div key={step.status} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className={cn('w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500',
                  done ? 'bg-success' : isCurrent ? 'border-2 border-primary' : 'border-2 border-border')}>
                  {done ? <CheckCircle2 size={14} className="text-white" /> : isCurrent ? <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" /> : <Circle size={14} className="text-border" />}
                </div>
                {index < ORDER_STEPS.length - 1 && <div className={cn('w-0.5 h-6 mt-1 transition-colors duration-500', done ? 'bg-success' : 'bg-border')} />}
              </div>
              <div className="pb-5">
                <p className={cn('text-sm font-medium transition-colors duration-500', done ? 'text-foreground' : isCurrent ? 'text-primary' : 'text-muted-foreground')}>{step.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-5 py-2 flex flex-col gap-2">
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Seu pedido</p>
          {order.lines.map(line => (
            <div key={`${line.menuItemId}-${line.notes}`} className="flex justify-between text-sm py-1 gap-3">
              <span>{line.quantity}× {line.name}{line.notes && <span className="text-muted-foreground"> · {line.notes}</span>}</span>
              <span className="text-muted-foreground flex-shrink-0">{formatCurrency(line.unitPrice * line.quantity)}</span>
            </div>
          ))}
          <div className="border-t border-border mt-2 pt-2 flex justify-between">
            <span className="font-display font-bold text-foreground text-sm">Total</span>
            <span className="font-display font-bold text-foreground text-sm">{formatCurrency(order.total)}</span>
          </div>
        </div>
        <button onClick={() => openOrder(order.id, 'receipt')} className="w-full border border-border rounded-xl py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors">
          Ver comprovante
        </button>
      </div>
    </div>
  );
}

/** Comprovante digital do pagamento (ficha 04). */
export function ReceiptScreen() {
  const { go, orderId, showToast } = useClient();
  const order = useOrder(orderId);
  if (!order) return null;

  const summary = [
    `${order.establishmentName} — Pedido #${order.number}`,
    ...order.lines.map(line => `${line.quantity}× ${line.name} ${formatCurrency(line.unitPrice * line.quantity)}`),
    `Total: ${formatCurrency(order.total)} · ${PAYMENT_METHOD_LABELS[order.paymentMethod]} · ${order.transactionId}`,
  ].join('\n');

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: `Comprovante #${order?.number}`, text: summary });
      else {
        await navigator.clipboard.writeText(summary);
        showToast('Comprovante copiado');
      }
    } catch {
      // Compartilhamento cancelado pelo usuário.
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-24">
      <ScreenHeader title="Comprovante" onBack={() => go('orders')} />
      <div className="px-5 py-5">
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="text-center border-b border-border pb-4 mb-4">
            <p className="font-display font-bold text-foreground text-xl">{order.establishmentName}</p>
            <p className="text-xs text-muted-foreground mt-3">
              Pedido #{order.number} · {formatDateTime(order.createdAt)}{order.tableLabel ? ` · ${order.tableLabel}` : ''}
            </p>
          </div>
          {order.lines.map(line => (
            <div key={`${line.menuItemId}-${line.notes}`} className="flex justify-between text-sm py-1.5 gap-3">
              <span>{line.quantity}× {line.name}</span>
              <span className="flex-shrink-0">{formatCurrency(line.unitPrice * line.quantity)}</span>
            </div>
          ))}
          <div className="border-t border-dashed border-border mt-3 pt-3">
            <div className="flex justify-between font-display font-bold"><span>Total</span><span>{formatCurrency(order.total)}</span></div>
          </div>
          <div className="border-t border-border mt-4 pt-4 text-center">
            <p className="text-xs text-muted-foreground">Pagamento</p>
            <p className="text-sm font-semibold text-foreground mt-0.5">{formatCurrency(order.total)} · {PAYMENT_METHOD_LABELS[order.paymentMethod]}</p>
            <p className="text-xs text-success font-medium mt-0.5">Aprovado</p>
            <p className="text-[11px] text-muted-foreground mt-2 font-mono">Transação {order.transactionId}</p>
          </div>
        </div>
        <button onClick={share} className="w-full mt-4 bg-card border border-border text-foreground font-medium py-3.5 rounded-xl text-sm flex items-center justify-center gap-2">
          <Share2 size={15} />
          Compartilhar comprovante
        </button>
      </div>
    </div>
  );
}
