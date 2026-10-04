import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Copy, CreditCard, Loader2, MapPin, Minus, Plus, QrCode, ShieldAlert, ShoppingCart, Trash2, X, Zap } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import { formatCardExpiry, formatCardNumber, isValidCardExpiry, isValidCardNumber, onlyDigits } from '@/lib/validation';
import { imageOrPlaceholder } from '@/lib/images';
import { formatPhone } from '@/lib/validation';
import { useRestaurantData } from '@/services/restaurantService';
import { DECLINED_CARD_SUFFIX, getEstimatedTime, getOrderStatus, placeOrder, processPayment, useOrder, type CardInput } from '@/services/orderService';
import type { PaymentMethod } from '@/types/order';
import { isAccountVerified, useClient } from '../clientContext';
import { useCartSummary } from '../hooks/useCart';
import { FixedBottom, ResultScreen, ScreenHeader } from '../components/Layout';
import { PAYMENT_METHOD_LABELS } from '../format';

/** Revisão do pedido: quantidades, remoção e total recalculado na hora (ficha 08). */
export function CartScreen() {
  const { go, account, table, changeCartQuantity, removeCartLine, setPostAuthScreen } = useClient();
  const { lines, subtotal, discount, total, hasUnavailable } = useCartSummary();
  const establishment = useRestaurantData(table?.establishmentId);

  function promptLogin() {
    setPostAuthScreen('cart');
    go('login');
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <ScreenHeader title="Carrinho" onBack={() => go('menu')} />
      {lines.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center py-24">
          <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center">
            <ShoppingCart size={32} className="text-muted-foreground" />
          </div>
          <div>
            <p className="font-display font-bold text-foreground text-lg">Carrinho vazio</p>
            <p className="text-muted-foreground text-sm mt-1">Adicione itens do cardápio para continuar</p>
          </div>
          <button onClick={() => go('menu')} className="bg-primary text-primary-foreground px-6 py-3 rounded-xl font-medium">Ver cardápio</button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pb-32">
          {establishment && table && (
            <p className="px-4 pt-4 text-xs text-muted-foreground">{establishment.name} · {table.tableLabel}</p>
          )}
          <div className="px-4 py-4 flex flex-col gap-3">
            {lines.map((line, index) => (
              <div key={`${line.itemId}-${line.notes}`} className={cn('bg-card rounded-xl border p-4', line.item.available ? 'border-border' : 'border-error/40')}>
                <div className="flex gap-3">
                  <img src={imageOrPlaceholder(line.item.image)} alt={line.item.name} className={cn('w-14 h-14 rounded-lg object-cover bg-muted flex-shrink-0', !line.item.available && 'grayscale')} />
                  <div className="flex-1 min-w-0">
                    <p className="font-display font-semibold text-foreground text-sm">{line.item.name}</p>
                    {line.notes && <p className="text-xs text-muted-foreground mt-0.5">{line.notes}</p>}
                    {line.item.available ? (
                      <div className="flex items-baseline gap-1.5 mt-1">
                        <p className="font-display font-bold text-foreground">{formatCurrency(line.item.finalPrice)}</p>
                        {line.item.promotion && <span className="text-xs text-muted-foreground line-through">{formatCurrency(line.item.price)}</span>}
                      </div>
                    ) : (
                      <p className="text-xs text-error font-medium mt-1">Esgotado — remova para continuar</p>
                    )}
                  </div>
                  <button onClick={() => removeCartLine(index)} className="p-1.5 text-error hover:bg-error-bg rounded-lg h-fit" aria-label={`Remover ${line.item.name}`}>
                    <Trash2 size={15} />
                  </button>
                </div>
                {line.item.available && (
                  <div className="flex items-center gap-3 mt-3">
                    <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5">
                      <button onClick={() => changeCartQuantity(index, -1)} className="text-primary" aria-label="Diminuir"><Minus size={14} /></button>
                      <span className="font-display font-bold text-sm w-4 text-center">{line.quantity}</span>
                      <button onClick={() => changeCartQuantity(index, 1)} className="text-primary" aria-label="Aumentar"><Plus size={14} /></button>
                    </div>
                    <span className="ml-auto font-display font-bold text-foreground">{formatCurrency(line.item.finalPrice * line.quantity)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="px-4 flex flex-col gap-3">
            <div className="bg-card rounded-xl border border-border p-4 flex flex-col gap-2">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
              {discount > 0 && (
                <div className="flex justify-between text-sm"><span className="text-success">Promoções</span><span className="text-success">-{formatCurrency(discount)}</span></div>
              )}
              <div className="border-t border-border my-1" />
              <div className="flex justify-between"><span className="font-display font-bold text-foreground">Total</span><span className="font-display font-bold text-foreground">{formatCurrency(total)}</span></div>
            </div>
            {establishment && (
              <div className="flex items-center gap-2 bg-muted rounded-xl px-4 py-3">
                <Clock size={14} className="text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Tempo estimado: <strong className="text-foreground">{establishment.avgTime}</strong></p>
              </div>
            )}
            {!account && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
                <p className="text-sm text-foreground font-medium">Crie uma conta para finalizar</p>
                <p className="text-xs text-muted-foreground mt-1">Visitantes não podem concluir pedidos.</p>
                <button onClick={promptLogin} className="text-primary text-sm font-medium mt-2">Entrar ou criar conta →</button>
              </div>
            )}
          </div>
        </div>
      )}
      {lines.length > 0 && account && (
        <FixedBottom>
          <button
            onClick={() => go('payment')}
            disabled={hasUnavailable}
            className="w-full bg-primary text-primary-foreground font-display font-bold py-4 rounded-xl text-base disabled:opacity-50"
          >
            Confirmar pedido · {formatCurrency(total)}
          </button>
        </FixedBottom>
      )}
    </div>
  );
}

const PIX_MOCK_CODE = '00020126580014BR.GOV.BCB.PIX0136filazero-demo-pix-copia-e-cola5204000053039865802BR';

type PaymentView = 'form' | 'processing' | 'error';

const EMPTY_CARD: CardInput = { number: '', holder: '', expiry: '', cvv: '' };

/** Pagamento por Pix ou cartão crédito/débito pelo app (ficha 04). */
export function PaymentScreen() {
  const { go, account, table, cartEstablishmentId, clearCart, openOrder, requestVerification, showToast } = useClient();
  const { lines, total, count, hasUnavailable } = useCartSummary();
  const establishment = useRestaurantData(cartEstablishmentId);
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [card, setCard] = useState<CardInput>(EMPTY_CARD);
  const [cardError, setCardError] = useState('');
  const [view, setView] = useState<PaymentView>('form');
  const [failureReason, setFailureReason] = useState('');

  if (!account || !establishment) return null;

  if (!isAccountVerified(account)) {
    const channel = account.email ? 'email' : 'phone';
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <ScreenHeader title="Pagamento" onBack={() => go('cart')} />
        <div className="flex-1 flex flex-col items-center justify-center px-8 gap-5 text-center">
          <div className="w-16 h-16 rounded-2xl bg-warning-bg flex items-center justify-center">
            <ShieldAlert size={28} className="text-warning" />
          </div>
          <div>
            <p className="font-display font-bold text-foreground text-xl">Confirme sua conta para pagar</p>
            <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
              Por segurança, o pagamento pelo app é liberado depois que você confirma seu {channel === 'email' ? 'e-mail' : 'celular'}.
            </p>
          </div>
          <button
            onClick={() => requestVerification({ purpose: 'contact', channel, destination: account.email ?? formatPhone(account.phone ?? ''), returnTo: 'payment' })}
            className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl"
          >
            Verificar agora
          </button>
        </div>
      </div>
    );
  }

  if (view === 'processing') {
    return (
      <ResultScreen
        icon={<div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center"><Loader2 size={36} className="text-primary animate-spin" /></div>}
        title="Processando pagamento"
        description="Aguarde, confirmando com o banco..."
      />
    );
  }

  if (view === 'error') {
    return (
      <ResultScreen
        icon={<div className="w-20 h-20 rounded-2xl bg-error-bg flex items-center justify-center"><X size={36} className="text-error" /></div>}
        title="Pagamento recusado"
        description={<>{failureReason} Nenhum valor foi cobrado e seu carrinho foi mantido.</>}
      >
        <button onClick={() => setView('form')} className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl">Tentar novamente</button>
        <button onClick={() => go('cart')} className="text-muted-foreground text-sm">Voltar ao carrinho</button>
      </ResultScreen>
    );
  }

  function validateCard() {
    if (!isValidCardNumber(card.number)) return 'Número do cartão inválido.';
    if (card.holder.trim().length < 3) return 'Informe o nome impresso no cartão.';
    if (!isValidCardExpiry(card.expiry, new Date())) return 'Validade inválida ou vencida.';
    if (!/^\d{3,4}$/.test(card.cvv)) return 'CVV inválido.';
    return '';
  }

  async function pay() {
    if (!account || !establishment) return;
    if (method !== 'pix') {
      const error = validateCard();
      setCardError(error);
      if (error) return;
    }
    setView('processing');
    const result = await processPayment(method, method === 'pix' ? undefined : card);
    if (!result.ok) {
      setFailureReason(result.reason);
      setView('error');
      return;
    }
    const order = placeOrder({
      accountId: account.id,
      establishmentId: establishment.id,
      establishmentName: establishment.name,
      table: table && table.establishmentId === establishment.id ? { id: table.tableId, label: table.tableLabel } : undefined,
      paymentMethod: method,
      transactionId: result.transactionId,
      lines: lines.map(line => ({ menuItemId: line.itemId, name: line.item.name, quantity: line.quantity, unitPrice: line.item.finalPrice, notes: line.notes })),
    });
    setCard(EMPTY_CARD);
    clearCart();
    openOrder(order.id, 'order-confirmed');
  }

  async function copyPixCode() {
    try {
      await navigator.clipboard.writeText(PIX_MOCK_CODE);
      showToast('Código Pix copiado');
    } catch {
      showToast('Não foi possível copiar o código');
    }
  }

  const methods: { id: PaymentMethod; icon: typeof Zap; label: string; sub: string; badge?: string }[] = [
    { id: 'pix', icon: Zap, label: 'Pix', sub: 'Confirmação instantânea', badge: 'Recomendado' },
    { id: 'credit', icon: CreditCard, label: 'Cartão de crédito', sub: 'Visa, Mastercard, Elo' },
    { id: 'debit', icon: CreditCard, label: 'Cartão de débito', sub: 'Débito à vista' },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <ScreenHeader title="Pagamento" onBack={() => go('cart')} />
      <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-4 pb-32">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Forma de pagamento</p>
        {methods.map(({ id, icon: Icon, label, sub, badge }) => (
          <button
            key={id}
            onClick={() => { setMethod(id); setCardError(''); }}
            className={cn('flex items-center gap-4 bg-card rounded-xl border p-4 text-left transition-all', method === id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40')}
          >
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', method === id ? 'bg-primary' : 'bg-muted')}>
              <Icon size={18} className={method === id ? 'text-white' : 'text-muted-foreground'} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-display font-semibold text-foreground text-sm">{label}</span>
                {badge && <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">{badge}</span>}
              </div>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </div>
            <div className={cn('w-5 h-5 rounded-full border-2 flex items-center justify-center', method === id ? 'border-primary' : 'border-border')}>
              {method === id && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
            </div>
          </button>
        ))}

        {method === 'pix' ? (
          <div className="bg-card rounded-xl border border-border p-5 flex flex-col items-center gap-3">
            <div className="w-36 h-36 bg-foreground rounded-xl flex items-center justify-center">
              <div className="w-28 h-28 bg-white rounded-lg flex items-center justify-center">
                <QrCode size={80} className="text-foreground" />
              </div>
            </div>
            <button onClick={copyPixCode} className="text-primary text-sm font-medium flex items-center gap-1.5">
              <Copy size={14} />
              Copiar código Pix
            </button>
          </div>
        ) : (
          <CardForm card={card} onChange={next => { setCard(next); setCardError(''); }} error={cardError} />
        )}

        <div className="bg-card rounded-xl border border-border p-4 flex flex-col gap-2">
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">{count} {count === 1 ? 'item' : 'itens'}</span><span>{formatCurrency(total)}</span></div>
          <div className="border-t border-border pt-2 flex justify-between">
            <span className="font-display font-bold text-foreground">Total</span>
            <span className="font-display font-bold text-foreground text-xl">{formatCurrency(total)}</span>
          </div>
        </div>
      </div>

      <FixedBottom>
        <button onClick={pay} disabled={hasUnavailable || lines.length === 0} className="w-full bg-primary text-primary-foreground font-display font-bold py-4 rounded-xl text-base disabled:opacity-50">
          {method === 'pix' ? 'Confirmar pagamento Pix' : `Pagar com ${PAYMENT_METHOD_LABELS[method].toLowerCase()}`}
        </button>
      </FixedBottom>
    </div>
  );
}

function CardForm({ card, onChange, error }: { card: CardInput; onChange: (card: CardInput) => void; error: string }) {
  const inputClass = 'w-full bg-card border border-border rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary';
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl p-5 flex flex-col gap-2" style={{ background: 'linear-gradient(135deg, #1a1a1a 0%, #333 100%)', minHeight: 140 }}>
        <div className="flex justify-between items-start">
          <CreditCard size={28} className="text-white/60" />
          <p className="text-white/60 text-sm">{card.number || '•••• •••• •••• ••••'}</p>
        </div>
        <div className="mt-auto">
          <p className="text-white/80 text-xs uppercase tracking-wider">{card.holder || 'NOME NO CARTÃO'}</p>
          <p className="text-white/60 text-xs mt-1">{card.expiry || 'MM/AA'}</p>
        </div>
      </div>
      <div>
        <label htmlFor="card-number" className="text-xs text-muted-foreground mb-1 block">Número do cartão</label>
        <input id="card-number" inputMode="numeric" autoComplete="cc-number" value={card.number} onChange={e => onChange({ ...card, number: formatCardNumber(e.target.value) })} placeholder="0000 0000 0000 0000" className={inputClass} />
      </div>
      <div>
        <label htmlFor="card-holder" className="text-xs text-muted-foreground mb-1 block">Nome no cartão</label>
        <input id="card-holder" autoComplete="cc-name" value={card.holder} onChange={e => onChange({ ...card, holder: e.target.value.toUpperCase().slice(0, 40) })} placeholder="COMO IMPRESSO NO CARTÃO" className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="card-expiry" className="text-xs text-muted-foreground mb-1 block">Validade</label>
          <input id="card-expiry" inputMode="numeric" autoComplete="cc-exp" value={card.expiry} onChange={e => onChange({ ...card, expiry: formatCardExpiry(e.target.value) })} placeholder="MM/AA" className={inputClass} />
        </div>
        <div>
          <label htmlFor="card-cvv" className="text-xs text-muted-foreground mb-1 block">CVV</label>
          <input id="card-cvv" inputMode="numeric" autoComplete="cc-csc" type="password" value={card.cvv} onChange={e => onChange({ ...card, cvv: onlyDigits(e.target.value).slice(0, 4) })} placeholder="•••" className={inputClass} />
        </div>
      </div>
      {error && (
        <p className="text-error text-xs flex items-center gap-1.5"><AlertTriangle size={12} />{error}</p>
      )}
      <p className="text-xs text-muted-foreground text-center leading-relaxed">
        Os dados do cartão vão direto para o provedor de pagamentos e não ficam salvos no app.
      </p>
      {import.meta.env.DEV && (
        <p className="text-[11px] text-muted-foreground text-center">Dev: 4111 1111 1111 1111 aprova · final {DECLINED_CARD_SUFFIX} (ex.: 4000 0000 0000 0002) recusa</p>
      )}
    </div>
  );
}

export function OrderConfirmedScreen() {
  const { orderId, go } = useClient();
  const order = useOrder(orderId);
  if (!order) return null;
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-8">
      <div className="w-24 h-24 rounded-2xl bg-success-bg flex items-center justify-center">
        <CheckCircle2 size={48} className="text-success" />
      </div>
      <div className="text-center">
        <p className="text-muted-foreground text-sm font-medium uppercase tracking-wider">Pagamento confirmado</p>
        <h1 className="font-display font-bold text-foreground text-4xl mt-2">PEDIDO #{order.number}</h1>
        {order.tableLabel && <p className="text-sm text-muted-foreground mt-1">{order.establishmentName} · {order.tableLabel}</p>}
      </div>
      <div className="w-full flex flex-col gap-3">
        <div className="bg-card rounded-xl border border-border px-5 py-4 flex items-center gap-3">
          <Clock size={18} className="text-primary" />
          <div><p className="text-xs text-muted-foreground">Tempo estimado</p><p className="font-display font-bold text-foreground">{getEstimatedTime(getOrderStatus(order, Date.parse(order.createdAt)))}</p></div>
        </div>
        <div className="bg-card rounded-xl border border-border px-5 py-4 flex items-center gap-3">
          <MapPin size={18} className="text-primary" />
          <div><p className="text-xs text-muted-foreground">Retirada</p><p className="font-display font-bold text-foreground">{order.pickupPoint}</p></div>
        </div>
      </div>
      <button onClick={() => go('order-tracking')} className="w-full bg-primary text-primary-foreground font-display font-bold py-4 rounded-xl text-base">Acompanhar pedido</button>
    </div>
  );
}
