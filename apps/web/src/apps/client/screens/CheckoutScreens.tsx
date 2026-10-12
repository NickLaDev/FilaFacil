import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Copy, CreditCard, Loader2, MapPin, Minus, Plus, QrCode, ShieldAlert, ShoppingCart, Trash2, X, Zap } from 'lucide-react';
import { errorMessage, isApiError } from '@/lib/api/client';
import { cn, formatCents, formatCurrency, formatTime } from '@/lib/utils';
import { formatCardExpiry, formatCardNumber, formatCpf, isValidCardExpiry, isValidCardNumber, isValidCpf, onlyDigits } from '@/lib/validation';
import { imageOrPlaceholder } from '@/lib/images';
import { formatPhone } from '@/lib/validation';
import { useRestaurantData } from '@/services/restaurantService';
import { CardError, isCardPaymentConfigured, tokenizeCard, type CardInput } from '@/services/mercadoPago';
import { useAuthProviders } from '@/services/authService';
import { queryClient } from '@/lib/api/queryClient';
import { checkoutAttempt, createOrder, finishCheckout, formatEstimate, ordersKey, payOrder, simulatePixPayment, syncOrderPayment, useOrder } from '@/services/orderService';
import type { CreatePaymentRequest, OrderDto, PaymentMethod } from '@/types/order';
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

type PaymentView = 'form' | 'processing' | 'pending' | 'error';

const EMPTY_CARD: CardInput = { number: '', holder: '', expiry: '', cvv: '', cpf: '' };

/** Mensagens para os motivos de recusa mais comuns informados pelo gateway. */
function refusalMessage(reason: string | null) {
  if (reason === 'cc_rejected_insufficient_amount') return 'Saldo ou limite insuficiente.';
  if (reason?.startsWith('cc_rejected_bad_filled')) return 'Confira os dados do cartão.';
  if (reason === 'cc_rejected_call_for_authorize' || reason === 'cc_rejected_card_disabled') return 'Cartão não autorizado. Fale com o banco.';
  return 'Pagamento recusado pela operadora do cartão.';
}

/** Cenários do cartão simulado (o cenário vai como `cardToken`; nenhum dado de cartão é digitado). */
const SIMULATED_SCENARIOS = [
  { id: 'sim_approved', label: 'Pagamento aprovado', hint: 'O pedido vai para a cozinha na hora.' },
  { id: 'sim_refused', label: 'Pagamento recusado', hint: 'Saldo ou limite insuficiente: dá para tentar de novo.' },
  { id: 'sim_error', label: 'Falha de processamento', hint: 'Erro no provedor: nada é cobrado e dá para tentar de novo.' },
] as const;

type SimulatedScenario = (typeof SIMULATED_SCENARIOS)[number]['id'];

/** Aviso fixo: nenhuma transação simulada tem valor financeiro. */
function SimulationBanner() {
  return (
    <div role="note" className="bg-warning-bg border border-warning/30 rounded-xl px-4 py-3 flex gap-2">
      <AlertTriangle size={15} className="text-warning flex-shrink-0 mt-0.5" />
      <p className="text-xs text-warning leading-relaxed">
        <strong>Pagamento simulado</strong> — ambiente de demonstração. Nenhum dinheiro é movido e a transação não tem valor financeiro.
      </p>
    </div>
  );
}

function ScenarioSelector({ value, onChange }: { value: SimulatedScenario; onChange: (value: SimulatedScenario) => void }) {
  return (
    <fieldset className="bg-card rounded-xl border border-border p-4 flex flex-col gap-3">
      <legend className="text-xs uppercase tracking-wider text-muted-foreground font-medium px-1">Cenário do teste (sem dados de cartão)</legend>
      {SIMULATED_SCENARIOS.map(scenario => (
        <label key={scenario.id} className={cn('flex items-start gap-3 rounded-lg border p-3 cursor-pointer', value === scenario.id ? 'border-primary bg-primary/5' : 'border-border')}>
          <input type="radio" name="simulated-scenario" checked={value === scenario.id} onChange={() => onChange(scenario.id)} className="mt-1 accent-primary" />
          <span>
            <span className="block text-sm font-medium text-foreground">{scenario.label}</span>
            <span className="block text-xs text-muted-foreground">{scenario.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Pagamento por Pix ou cartão crédito/débito pelo app (ficha 04). */
export function PaymentScreen() {
  const { go, account, table, cart, cartEstablishmentId, clearCart, openOrder, requestVerification } = useClient();
  const { lines, total, count, hasUnavailable } = useCartSummary();
  const establishment = useRestaurantData(cartEstablishmentId);
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [card, setCard] = useState<CardInput>(EMPTY_CARD);
  const [cardError, setCardError] = useState('');
  const [view, setView] = useState<PaymentView>('form');
  const [failureReason, setFailureReason] = useState('');
  const [pendingOrder, setPendingOrder] = useState<OrderDto | null>(null);
  const [scenario, setScenario] = useState<SimulatedScenario>('sim_approved');
  const provider = useAuthProviders().data?.paymentProvider;
  const simulated = provider === 'simulated';
  const paymentUnavailable = provider === 'none';

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

  function paid(order: Pick<OrderDto, 'id'>) {
    setCard(EMPTY_CARD);
    finishCheckout();
    clearCart();
    openOrder(order.id, 'order-confirmed');
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

  if (view === 'pending' && pendingOrder) {
    return (
      <PendingPayment
        order={pendingOrder}
        onPaid={paid}
        onChangeMethod={() => setView('form')}
        onRetry={() => setView('form')}
      />
    );
  }

  if (view === 'error') {
    return (
      <ResultScreen
        icon={<div className="w-20 h-20 rounded-2xl bg-error-bg flex items-center justify-center"><X size={36} className="text-error" /></div>}
        title="Pagamento não concluído"
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
    if (!isValidCpf(card.cpf)) return 'CPF do titular inválido.';
    return '';
  }

  /** Mostra o motivo e mantém o carrinho; o pedido já criado é reaproveitado na próxima tentativa. */
  function fail(message: string, { newOrder = false } = {}) {
    if (newOrder) finishCheckout();
    setFailureReason(message);
    setView('error');
  }

  async function pay() {
    if (!account || !establishment) return;
    let request: CreatePaymentRequest = { method };
    if (method !== 'pix' && simulated) {
      // Demonstração: o cenário escolhido vai no lugar do token do cartão (nenhum dado de cartão existe).
      request = { method, cardToken: scenario, paymentMethodId: 'simulated' };
      setView('processing');
    } else if (method !== 'pix') {
      const error = validateCard();
      setCardError(error);
      if (error) return;
      setView('processing');
      try {
        request = { method, ...(await tokenizeCard(card, method)) };
      } catch (failure) {
        setCardError(failure instanceof CardError ? failure.message : 'Não foi possível validar o cartão.');
        setView('form');
        return;
      }
    } else {
      setView('processing');
    }

    // O total exibido vai junto no pedido e no pagamento: se o servidor tiver outro valor, nada é cobrado. O total
    // também compõe o resumo do carrinho, então preço novo = nova tentativa (outro pedido), nunca o pedido velho.
    const totalCents = Math.round(total * 100);
    const signature = JSON.stringify([cartEstablishmentId, table?.tableId, totalCents, cart.map(line => [line.itemId, line.quantity, line.notes])]);
    const attempt = checkoutAttempt(signature);
    try {
      const orderId =
        attempt.orderId ??
        (
          await createOrder({
            establishmentId: establishment.id,
            tableId: table && table.establishmentId === establishment.id ? table.tableId : undefined,
            clientRequestId: attempt.clientRequestId,
            expectedTotalCents: totalCents,
            items: lines.map(line => ({ menuItemId: line.itemId, quantity: line.quantity, notes: line.notes })),
          })
        ).id;
      attempt.orderId = orderId;
      const order = await payOrder(orderId, { ...request, expectedTotalCents: totalCents });
      setCard(EMPTY_CARD);
      if (order.status === 'paid') return paid(order);
      const status = order.payment?.status;
      if (status === 'pending') {
        setPendingOrder(order);
        return setView('pending');
      }
      fail(status === 'refused' ? refusalMessage(order.payment?.failureReason ?? null) : 'O pagamento não foi concluído.');
    } catch (failure) {
      // Conflitos com o pedido guardado: o servidor explica e o próximo envio começa um pedido novo.
      for (const code of ['PRICE_CHANGED', 'ORDER_TOTAL_CHANGED', 'ORDER_CONTENT_CHANGED', 'ORDER_EXPIRED', 'ITEM_UNAVAILABLE', 'ESTABLISHMENT_NOT_ACCEPTING_ORDERS']) {
        if (isApiError(failure, code)) return fail(failure.message, { newOrder: true });
      }
      if (isApiError(failure, 'ALREADY_PAID') || isApiError(failure, 'ORDER_NOT_PAYABLE')) {
        if (attempt.orderId) return paid({ id: attempt.orderId });
      }
      if (isApiError(failure, 'CONTACT_NOT_VERIFIED')) return fail('Confirme seu e-mail ou celular para pagar pelo app.');
      fail(errorMessage(failure, 'Não foi possível processar o pagamento. Tente novamente.'));
    }
  }

  const methods: { id: PaymentMethod; icon: typeof Zap; label: string; sub: string; badge?: string }[] = [
    { id: 'pix', icon: Zap, label: 'Pix', sub: 'Confirmação instantânea', badge: 'Recomendado' },
    { id: 'credit', icon: CreditCard, label: 'Cartão de crédito', sub: 'Visa, Mastercard, Elo' },
    { id: 'debit', icon: CreditCard, label: 'Cartão de débito', sub: 'Débito à vista' },
  ];
  const cardUnavailable = method !== 'pix' && !simulated && !isCardPaymentConfigured;

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

        {simulated && <SimulationBanner />}
        {paymentUnavailable && (
          <div className="bg-warning-bg border border-warning/20 rounded-xl p-4 flex gap-2">
            <AlertTriangle size={15} className="text-warning flex-shrink-0 mt-0.5" />
            <p className="text-sm text-warning">O pagamento pelo app não está disponível no momento.</p>
          </div>
        )}
        {method === 'pix' ? (
          <div className="bg-card rounded-xl border border-border p-5 flex items-center gap-3">
            <QrCode size={28} className="text-primary flex-shrink-0" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              {simulated
                ? 'Vamos gerar um Pix simulado. Na próxima etapa você confirma o pagamento com um botão de demonstração.'
                : 'O QR Code e o código Pix copia e cola aparecem na próxima etapa, depois de confirmar.'}
            </p>
          </div>
        ) : simulated ? (
          <ScenarioSelector value={scenario} onChange={setScenario} />
        ) : cardUnavailable ? (
          <div className="bg-warning-bg border border-warning/20 rounded-xl p-4 flex gap-2">
            <AlertTriangle size={15} className="text-warning flex-shrink-0 mt-0.5" />
            <p className="text-sm text-warning">O pagamento com cartão não está disponível neste ambiente. Use o Pix.</p>
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
        <button onClick={() => void pay()} disabled={hasUnavailable || lines.length === 0 || cardUnavailable || paymentUnavailable} className="w-full bg-primary text-primary-foreground font-display font-bold py-4 rounded-xl text-base disabled:opacity-50">
          {method === 'pix' ? 'Gerar Pix' : `Pagar com ${PAYMENT_METHOD_LABELS[method].toLowerCase()}`}
        </button>
      </FixedBottom>
    </div>
  );
}

/**
 * Pagamento criado e ainda não confirmado (Pix aguardando o cliente pagar). O app pergunta ao servidor
 * a cada poucos segundos — e o servidor consulta o Mercado Pago —, além de reagir ao aviso em tempo real.
 */
function PendingPayment({ order, onPaid, onChangeMethod, onRetry }: { order: OrderDto; onPaid: (order: OrderDto) => void; onChangeMethod: () => void; onRetry: () => void }) {
  const { go, showToast } = useClient();
  const sync = useQuery({
    queryKey: [...ordersKey, order.id, 'sync'],
    queryFn: () => syncOrderPayment(order.id),
    refetchInterval: 4_000,
    initialData: order,
    staleTime: 0,
  });
  const current = sync.data;
  const payment = current.payment;
  const status = payment?.status;

  useEffect(() => {
    if (current.status === 'paid') onPaid(current);
  }, [current, onPaid]);

  const [confirming, setConfirming] = useState(false);

  /** Demonstração: "o cliente paga o Pix". O servidor confirma e o resultado chega pela mesma consulta de sempre. */
  async function simulatePix() {
    setConfirming(true);
    try {
      const paid = await simulatePixPayment(order.id);
      queryClient.setQueryData([...ordersKey, order.id, 'sync'], paid);
    } catch (failure) {
      showToast(errorMessage(failure, 'Não foi possível simular o pagamento.'));
    } finally {
      setConfirming(false);
    }
  }

  async function copyPixCode() {
    if (!payment?.pix) return;
    try {
      await navigator.clipboard.writeText(payment.pix.copyPaste);
      showToast('Código Pix copiado');
    } catch {
      showToast('Não foi possível copiar o código');
    }
  }

  if (status === 'expired' || status === 'cancelled' || status === 'refused') {
    return (
      <ResultScreen
        icon={<div className="w-20 h-20 rounded-2xl bg-warning-bg flex items-center justify-center"><Clock size={36} className="text-warning" /></div>}
        title={status === 'refused' ? 'Pagamento recusado' : 'Pix expirado'}
        description="Nenhum valor foi cobrado. Gere um novo pagamento para continuar."
      >
        <button onClick={onRetry} className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl">Tentar novamente</button>
        <button onClick={() => go('cart')} className="text-muted-foreground text-sm">Voltar ao carrinho</button>
      </ResultScreen>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <ScreenHeader title={payment?.pix ? 'Pagamento Pix' : 'Pagamento'} onBack={onChangeMethod} />
      <div className="flex-1 px-4 py-6 flex flex-col items-center gap-4 text-center" aria-live="polite">
        {payment?.simulated && <SimulationBanner />}
        {payment?.pix && payment.simulated ? (
          <div className="bg-card rounded-xl border border-dashed border-warning p-5 flex flex-col items-center gap-3 w-full">
            <QrCode size={48} className="text-muted-foreground" />
            <p className="text-xs uppercase tracking-wider text-warning font-bold">Pix simulado — não pagável</p>
            <p className="font-mono text-xs text-foreground break-all">{payment.pix.copyPaste}</p>
            <button
              onClick={() => void simulatePix()}
              disabled={confirming}
              className="w-full bg-primary text-primary-foreground font-display font-semibold py-3 rounded-xl disabled:opacity-60"
            >
              {confirming ? 'Confirmando…' : 'Simular pagamento do Pix'}
            </button>
          </div>
        ) : payment?.pix && (
          <div className="bg-card rounded-xl border border-border p-5 flex flex-col items-center gap-3 w-full">
            <div className="w-44 h-44 bg-white rounded-xl border border-border flex items-center justify-center overflow-hidden">
              {payment.pix.qrBase64 ? (
                <img src={`data:image/png;base64,${payment.pix.qrBase64}`} alt="QR Code do Pix" className="w-full h-full object-contain" />
              ) : (
                <QrCode size={80} className="text-foreground" />
              )}
            </div>
            <button onClick={() => void copyPixCode()} className="text-primary text-sm font-medium flex items-center gap-1.5">
              <Copy size={14} />
              Copiar código Pix
            </button>
            {payment.pix.expiresAt && <p className="text-xs text-muted-foreground">Válido até {formatTime(payment.pix.expiresAt)}</p>}
          </div>
        )}
        <p className="font-display font-bold text-foreground text-2xl">{formatCents(current.totalCents)}</p>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin text-primary" />
          <span>Aguardando a confirmação do pagamento…</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-xs">
          {payment && !payment.pix && !payment.transactionId
            ? 'Estamos confirmando seu pagamento com o banco. Não pague de novo: se a cobrança já foi feita, o pedido segue sozinho.'
            : 'Assim que o banco confirmar, seu pedido vai para a cozinha. Você pode deixar esta tela aberta.'}
        </p>
        <button onClick={onChangeMethod} className="text-primary text-sm font-medium mt-2">Escolher outra forma de pagamento</button>
      </div>
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
      <div>
        <label htmlFor="card-cpf" className="text-xs text-muted-foreground mb-1 block">CPF do titular</label>
        <input id="card-cpf" inputMode="numeric" value={card.cpf} onChange={e => onChange({ ...card, cpf: formatCpf(e.target.value) })} placeholder="000.000.000-00" className={inputClass} />
      </div>
      {error && (
        <p className="text-error text-xs flex items-center gap-1.5"><AlertTriangle size={12} />{error}</p>
      )}
      <p className="text-xs text-muted-foreground text-center leading-relaxed">
        Os dados do cartão vão direto para o Mercado Pago e não passam pelo servidor do app nem ficam salvos.
      </p>
    </div>
  );
}

export function OrderConfirmedScreen() {
  const { orderId, go } = useClient();
  const order = useOrder(orderId).data;
  if (!order) return null;
  const estimate = formatEstimate(order);
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
        {estimate && (
          <div className="bg-card rounded-xl border border-border px-5 py-4 flex items-center gap-3">
            <Clock size={18} className="text-primary" />
            <div><p className="text-xs text-muted-foreground">Tempo estimado</p><p className="font-display font-bold text-foreground">{estimate}</p></div>
          </div>
        )}
        <div className="bg-card rounded-xl border border-border px-5 py-4 flex items-center gap-3">
          <MapPin size={18} className="text-primary" />
          <div><p className="text-xs text-muted-foreground">Retirada</p><p className="font-display font-bold text-foreground">{order.pickupPoint}</p></div>
        </div>
      </div>
      <button onClick={() => go('order-tracking')} className="w-full bg-primary text-primary-foreground font-display font-bold py-4 rounded-xl text-base">Acompanhar pedido</button>
    </div>
  );
}
