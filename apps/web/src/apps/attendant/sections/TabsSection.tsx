import { useMemo, useRef, useState } from 'react';
import { Receipt, X } from 'lucide-react';
import type { PaymentMethod, StaffOrderDto, TabDto } from '@filafacil/shared';
import EmptyState from '@/components/ui/EmptyState';
import { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, createId, formatCents } from '@/lib/utils';
import { addOrderToTab, closeTab, openTab, removeOrderFromTab, useOrderQueue, useTabs, useUnpaidOrders } from '@/services/operationsService';
import { useTableMap } from '@/services/floorService';

const SETTLEMENT_LABEL = { unpaid: 'Aguardando pagamento', paid: 'Pago', on_tab: 'Na comanda', settled_on_tab: 'Pago na comanda', refunded: 'Estornado' } as const;

/** Fichas 17 e 22: comandas por mesa/grupo; fechar cobra só o saldo (pedidos já pagos nunca são cobrados de novo). */
export default function TabsSection({ establishmentId, notify }: { establishmentId: string; notify: (message: string) => void }) {
  const tabs = useTabs(establishmentId, 'open');
  const map = useTableMap(establishmentId);
  const queue = useOrderQueue(establishmentId);
  const unpaid = useUnpaidOrders(establishmentId);
  const { run, pending } = useAsyncAction(notify);
  const [tableId, setTableId] = useState('');

  const candidates = useMemo<StaffOrderDto[]>(() => {
    const all = [...(queue.data?.items ?? []), ...(unpaid.data?.items ?? [])];
    return all.filter(order => order.tableId && !order.tabId && order.settlement !== 'refunded');
  }, [queue.data, unpaid.data]);

  if (tabs.error && !tabs.data) return <ErrorBlock error={tabs.error} onRetry={() => void tabs.refetch()} className="flex-1 py-16" />;
  if (!tabs.data) return <LoadingBlock className="flex-1 py-16" />;

  return (
    <div className="flex-1 overflow-auto p-5">
      <div className="flex gap-2 mb-4 max-w-xl">
        <select aria-label="Mesa da nova comanda" value={tableId} onChange={e => setTableId(e.target.value)} className={PANEL_INPUT_CLASS}>
          <option value="">Escolha a mesa…</option>
          {(map.data?.tables ?? []).map(table => (
            <option key={table.id} value={table.id}>{table.label}</option>
          ))}
        </select>
        <button
          disabled={pending || !tableId}
          onClick={() => void run(() => openTab(establishmentId, tableId), 'Comanda aberta')}
          className="bg-primary text-primary-foreground text-sm font-medium rounded-xl px-4 disabled:opacity-50 whitespace-nowrap"
        >
          Abrir comanda
        </button>
      </div>
      {tabs.data.length === 0 ? (
        <EmptyState icon={Receipt} title="Nenhuma comanda aberta" description="Abra a comanda de uma mesa para atribuir pedidos e cobrar tudo no fim." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 max-w-6xl">
          {tabs.data.map(tab => (
            <TabCard key={tab.id} tab={tab} establishmentId={establishmentId} candidates={candidates.filter(o => o.tableId && tab.tableIds.includes(o.tableId))} run={run} pending={pending} />
          ))}
        </div>
      )}
    </div>
  );
}

function TabCard({ tab, establishmentId, candidates, run, pending }: { tab: TabDto; establishmentId: string; candidates: StaffOrderDto[]; run: ReturnType<typeof useAsyncAction>['run']; pending: boolean }) {
  const [orderId, setOrderId] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('credit');
  const [scenario, setScenario] = useState('sim_approved');
  // A chave só muda quando o cliente decide tentar de novo após uma recusa; repetir o clique reaproveita a mesma.
  const key = useRef(createId('close-tab-' + tab.id.slice(0, 8)).padEnd(8, '0'));
  const hasStarted = tab.orders.some(o => o.status === 'preparing' || o.status === 'ready' || o.status === 'delivered');

  const close = () =>
    run(
      async () => {
        try {
          return await closeTab(establishmentId, tab.id, { idempotencyKey: key.current, method, cardToken: tab.balanceCents > 0 ? scenario : undefined, paymentMethodId: tab.balanceCents > 0 ? 'simulated' : undefined });
        } catch (error) {
          key.current = createId('close-tab-' + tab.id.slice(0, 8)); // recusa: nova tentativa usa nova chave
          throw error;
        }
      },
      result => (result.chargedCents > 0 ? `Comanda fechada · cobrado ${formatCents(result.chargedCents)}` : 'Comanda fechada · sem saldo a cobrar'),
    );

  return (
    <article data-testid="tab-card" aria-label={`Comanda ${tab.label}`} className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-bold text-foreground">{tab.label}</h3>
        <span className="text-xs text-muted-foreground">{tab.orders.length} pedido{tab.orders.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm">
        {tab.orders.map(order => (
          <li key={order.id} className="flex items-center justify-between gap-2">
            <span>#{order.number} · {order.items.map(i => `${i.quantity}× ${i.name}`).join(', ')}</span>
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span className={cn('text-[11px] px-2 py-0.5 rounded-full', order.settlement === 'on_tab' ? 'bg-warning-bg text-warning' : 'bg-muted text-muted-foreground')}>{SETTLEMENT_LABEL[order.settlement]}</span>
              <span className={order.status === 'cancelled' ? 'line-through text-muted-foreground' : ''}>{formatCents(order.totalCents)}</span>
              {order.settlement === 'on_tab' && order.status === 'received' && (
                <button disabled={pending} aria-label={`Remover pedido ${order.number} da comanda`} onClick={() => void run(() => removeOrderFromTab(establishmentId, tab.id, order.id), 'Pedido removido da comanda')} className="text-muted-foreground disabled:opacity-50">
                  <X size={13} />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {candidates.length > 0 && (
        <div className="flex gap-2">
          <select aria-label="Pedido a atribuir à comanda" value={orderId} onChange={e => setOrderId(e.target.value)} className={cn(PANEL_INPUT_CLASS, 'py-1.5')}>
            <option value="">Atribuir pedido da mesa…</option>
            {candidates.map(o => (
              <option key={o.id} value={o.id}>#{o.number} · {formatCents(o.totalCents)} · {SETTLEMENT_LABEL[o.settlement]}</option>
            ))}
          </select>
          <button disabled={pending || !orderId} onClick={() => void run(async () => { await addOrderToTab(establishmentId, tab.id, orderId); setOrderId(''); }, 'Pedido atribuído à comanda')} className="px-3 border border-border rounded-xl text-xs font-medium disabled:opacity-50">
            Atribuir
          </button>
        </div>
      )}
      <dl className="text-sm border-t border-border pt-2 flex flex-col gap-1">
        <div className="flex justify-between"><dt className="text-muted-foreground">Total</dt><dd data-testid="tab-total">{formatCents(tab.totalCents)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted-foreground">Já pago</dt><dd data-testid="tab-paid">{formatCents(tab.paidCents)}</dd></div>
        <div className="flex justify-between font-bold"><dt>Saldo</dt><dd data-testid="tab-balance">{formatCents(tab.balanceCents)}</dd></div>
      </dl>
      <div className="flex gap-2 items-center flex-wrap">
        {tab.balanceCents > 0 && (
          <>
            <select aria-label="Forma de pagamento" value={method} onChange={e => setMethod(e.target.value as PaymentMethod)} className={cn(PANEL_INPUT_CLASS, 'w-auto py-1.5')}>
              <option value="credit">Crédito</option>
              <option value="debit">Débito</option>
            </select>
            <select aria-label="Cartão simulado" value={scenario} onChange={e => setScenario(e.target.value)} className={cn(PANEL_INPUT_CLASS, 'w-auto py-1.5')}>
              <option value="sim_approved">Simulado: aprovado</option>
              <option value="sim_refused">Simulado: recusado</option>
              <option value="sim_error">Simulado: erro</option>
            </select>
          </>
        )}
        <button disabled={pending} onClick={() => void close()} className="flex-1 bg-primary text-primary-foreground text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
          {tab.balanceCents > 0 ? `Fechar e pagar ${formatCents(tab.balanceCents)}` : 'Fechar comanda'}
        </button>
      </div>
      {hasStarted && <p className="text-[11px] text-muted-foreground">Pedidos em preparo já não podem sair da comanda.</p>}
    </article>
  );
}
