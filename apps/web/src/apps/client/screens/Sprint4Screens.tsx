import { useMemo, useState } from 'react';
import { Bell, CalendarCheck, Check, CreditCard, Minus, Plus, ShieldAlert, Star, Trash2, Wallet, X } from 'lucide-react';
import {
  ALLERGENS,
  BOOKING_MAX_DAYS_AHEAD,
  BOOKING_MAX_PARTY,
  BOOKING_STATUS_LABELS,
  CARD_BRAND_LABELS,
  type AppNotificationDto,
  type BookingDto,
  type CashbackEntryDto,
} from '@filafacil/shared';
import BottomSheet from '@/components/ui/BottomSheet';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { errorMessage } from '@/lib/api/client';
import { cn, formatCents, formatDateTime, formatDateTimeIn } from '@/lib/utils';
import { formatCardExpiry, formatCardNumber, isValidCardExpiry, isValidCardNumber, onlyDigits } from '@/lib/validation';
import { useAuthProviders } from '@/services/authService';
import { useRestaurant } from '@/services/restaurantService';
import { useOrder } from '@/services/orderService';
import {
  cancelMyBooking,
  createBooking,
  markNotificationsRead,
  removePaymentMethod,
  reviewOrder,
  savePaymentMethod,
  setDefaultPaymentMethod,
  updateDietaryRestrictions,
  useBookingSlots,
  useCashback,
  useNotifications,
  usePaymentMethods,
} from '@/services/sprint4Service';
import { useClient } from '../clientContext';
import { FixedBottom, ScreenHeader } from '../components/Layout';
import { TextField } from '../components/AuthFields';

// ─── Cashback (ficha 15) ────────────────────────────────────────────────────

const CASHBACK_LABEL: Record<CashbackEntryDto['type'], string> = {
  earn: 'Cashback ganho',
  redeem: 'Cashback usado',
  redeem_return: 'Cashback devolvido',
  earn_reversal: 'Cashback estornado',
};

/** Saldo e extrato de cashback; o uso é escolhido no pagamento do pedido. */
export function CashbackScreen() {
  const { go, table } = useClient();
  const query = useCashback(true);
  const data = query.data;
  return (
    <div className="min-h-screen bg-background flex flex-col pb-24">
      <ScreenHeader title="Meu cashback" onBack={() => go('profile')} />
      {query.error && !data ? (
        <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
      ) : !data ? (
        <LoadingBlock className="py-16" />
      ) : (
        <div className="px-5 py-5 flex flex-col gap-4">
          <div className="bg-secondary text-secondary-foreground rounded-2xl p-5 flex flex-col gap-1">
            <p className="text-xs uppercase tracking-widest opacity-80 flex items-center gap-1.5"><Wallet size={12} />Saldo disponível</p>
            <p data-testid="cashback-balance" className="font-display font-extrabold text-4xl">{formatCents(data.balanceCents)}</p>
            {data.pendingCents > 0 && (
              <p data-testid="cashback-pending" className="text-sm opacity-90">+ {formatCents(data.pendingCents)} a receber quando seus pedidos forem entregues</p>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-4 text-sm flex flex-col gap-2">
            <p className="font-display font-semibold text-foreground">Como funciona</p>
            <p className="text-muted-foreground">Pedidos em restaurantes e promoções com cashback devolvem uma parte do valor para você.</p>
            <p className="text-muted-foreground">O valor entra no seu saldo quando o pedido é entregue e pago. Use o saldo como desconto no pagamento do próximo pedido — sem cupom.</p>
            <p className="text-muted-foreground">Se o pedido for cancelado ou estornado, o cashback ganho é revertido e o usado volta para você.</p>
          </div>

          <button onClick={() => go(table ? 'menu' : 'explore')} className="w-full bg-card border border-border text-foreground font-medium py-3.5 rounded-xl text-sm">
            {table ? 'Ver cardápio' : 'Encontrar restaurantes'}
          </button>

          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Extrato</p>
            {data.entries.length === 0 ? (
              <p data-testid="cashback-empty" className="text-sm text-muted-foreground bg-card border border-border rounded-xl px-4 py-5 text-center">Nenhuma movimentação ainda.</p>
            ) : (
              <ul className="bg-card border border-border rounded-xl divide-y divide-border">
                {data.entries.map(entry => (
                  <li key={entry.id} data-testid="cashback-entry" data-entry-type={entry.type} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="text-foreground font-medium">{CASHBACK_LABEL[entry.type]} · Pedido #{entry.orderNumber}</p>
                      <p className="text-xs text-muted-foreground truncate">{entry.establishmentName} · {formatDateTime(entry.createdAt)}</p>
                    </div>
                    <span className={cn('font-display font-bold flex-shrink-0', entry.cents >= 0 ? 'text-success' : 'text-error')}>{entry.cents > 0 ? '+' : '−'}{formatCents(Math.abs(entry.cents))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Métodos de pagamento salvos (ficha 49) ─────────────────────────────────

const EMPTY_CARD = { number: '', holder: '', expiry: '', cvv: '', kind: 'credit' as 'credit' | 'debit', makeDefault: false };

export function PaymentMethodsScreen() {
  const { go, showToast } = useClient();
  const methods = usePaymentMethods(true);
  const provider = useAuthProviders().data?.paymentProvider;
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_CARD);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const vaultAvailable = provider === 'simulated';

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      showToast(success);
    } catch (failure) {
      showToast(errorMessage(failure));
    }
  }

  function validate() {
    if (!isValidCardNumber(form.number)) return 'Número do cartão inválido.';
    if (form.holder.trim().length < 3) return 'Informe o nome impresso no cartão.';
    if (!isValidCardExpiry(form.expiry, new Date())) return 'Validade inválida ou vencida.';
    if (!/^\d{3,4}$/.test(form.cvv)) return 'CVV inválido.';
    return '';
  }

  async function add() {
    const problem = validate();
    setError(problem);
    if (problem) return;
    setSaving(true);
    try {
      const [month, year] = form.expiry.split('/').map(Number);
      await savePaymentMethod({ kind: form.kind, number: onlyDigits(form.number), holderName: form.holder.trim(), expMonth: month ?? 0, expYear: 2000 + (year ?? 0), cvv: form.cvv, makeDefault: form.makeDefault });
      setForm(EMPTY_CARD);
      setAdding(false);
      showToast('Cartão salvo');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-24">
      <ScreenHeader title="Métodos de pagamento" onBack={() => go('profile')} />
      <div className="px-5 py-5 flex flex-col gap-3">
        <p className="text-xs text-muted-foreground leading-relaxed">Guardamos só a bandeira, o final e a validade. O número do cartão fica protegido no cofre do provedor de pagamento e o CVV nunca é guardado.</p>
        {methods.error ? (
          <ErrorBlock error={methods.error} onRetry={() => void methods.refetch()} className="py-6" />
        ) : !methods.data ? (
          <LoadingBlock className="py-6" />
        ) : methods.data.length === 0 ? (
          <p data-testid="methods-empty" className="text-sm text-muted-foreground text-center py-6">Nenhum cartão salvo.</p>
        ) : (
          methods.data.map(method => (
            <div key={method.id} data-testid="saved-method" className={cn('bg-card border rounded-xl p-4 flex items-start gap-4', method.isDefault ? 'border-primary/40' : 'border-border')}>
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0"><CreditCard size={18} className="text-muted-foreground" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-display font-semibold text-foreground text-sm">{CARD_BRAND_LABELS[method.brand]} •••• {method.last4}</p>
                  {method.isDefault && <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">Padrão</span>}
                  {method.expired && <span className="text-[10px] font-bold text-error bg-error-bg px-1.5 py-0.5 rounded-full">Vencido</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{method.kind === 'credit' ? 'Crédito' : 'Débito'} · vence {String(method.expMonth).padStart(2, '0')}/{String(method.expYear).slice(-2)} · {method.holderName}</p>
                {!method.isDefault && !method.expired && (
                  <button onClick={() => void run(() => setDefaultPaymentMethod(method.id), 'Cartão padrão atualizado')} className="text-primary text-xs font-medium mt-1.5">Definir como padrão</button>
                )}
              </div>
              <button onClick={() => void run(() => removePaymentMethod(method.id), 'Cartão removido')} className="p-1.5 hover:bg-muted rounded-lg" aria-label={`Remover cartão final ${method.last4}`}>
                <Trash2 size={14} className="text-muted-foreground" />
              </button>
            </div>
          ))
        )}
        {vaultAvailable ? (
          <button onClick={() => { setError(''); setAdding(true); }} className="w-full border border-dashed border-border text-muted-foreground py-4 rounded-xl flex items-center justify-center gap-2 text-sm hover:bg-muted/50">
            <Plus size={16} />
            Adicionar cartão
          </button>
        ) : (
          <p role="note" className="text-xs text-warning bg-warning-bg border border-warning/30 rounded-xl px-4 py-3">Salvar cartões não está disponível neste ambiente (exige o cofre do provedor de pagamento).</p>
        )}
      </div>

      {adding && (
        <BottomSheet onClose={() => setAdding(false)}>
          <p className="font-display font-bold text-foreground text-lg mb-1">Novo cartão</p>
          <p role="note" className="text-xs text-warning mb-4">Ambiente de demonstração: nenhum cartão real é cobrado. Use um número de teste (ex.: 4242 4242 4242 4242; final 0002 é sempre recusado).</p>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2">
              {(['credit', 'debit'] as const).map(kind => (
                <button key={kind} onClick={() => setForm(prev => ({ ...prev, kind }))} className={cn('py-2.5 rounded-xl text-sm border', form.kind === kind ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-muted-foreground')}>
                  {kind === 'credit' ? 'Crédito' : 'Débito'}
                </button>
              ))}
            </div>
            <TextField label="Número do cartão" value={form.number} onChange={value => setForm(prev => ({ ...prev, number: formatCardNumber(value) }))} inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" />
            <TextField label="Nome impresso no cartão" value={form.holder} onChange={holder => setForm(prev => ({ ...prev, holder: holder.slice(0, 60) }))} autoComplete="cc-name" />
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Validade" value={form.expiry} onChange={value => setForm(prev => ({ ...prev, expiry: formatCardExpiry(value) }))} inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA" />
              <TextField label="CVV" value={form.cvv} onChange={value => setForm(prev => ({ ...prev, cvv: onlyDigits(value).slice(0, 4) }))} inputMode="numeric" autoComplete="cc-csc" />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={form.makeDefault} onChange={event => setForm(prev => ({ ...prev, makeDefault: event.target.checked }))} className="accent-primary" />
              Usar como cartão padrão
            </label>
            {error && <p role="alert" className="text-error text-sm">{error}</p>}
            <button onClick={() => void add()} disabled={saving} className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl disabled:opacity-60 flex items-center justify-center gap-2">
              <Check size={16} />
              {saving ? 'Salvando…' : 'Salvar cartão'}
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

// ─── Alergias e restrições (ficha 64) ───────────────────────────────────────

export function DietaryScreen() {
  const { go, account, showToast } = useClient();
  const [selected, setSelected] = useState<string[]>(account?.dietaryRestrictions ?? []);
  const [saving, setSaving] = useState(false);
  if (!account) return null;
  const changed = selected.slice().sort().join() !== account.dietaryRestrictions.slice().sort().join();

  async function save() {
    setSaving(true);
    try {
      await updateDietaryRestrictions(selected);
      showToast('Restrições salvas');
      go('profile');
    } catch (failure) {
      showToast(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-28">
      <ScreenHeader title="Alergias e restrições" onBack={() => go('profile')} />
      <div className="px-5 py-5 flex flex-col gap-4">
        <p className="text-sm text-muted-foreground leading-relaxed">Marque tudo o que você não pode comer. Vamos avisar quando um item do cardápio contiver algo da sua lista, antes de você adicioná-lo ao pedido.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Restrições alimentares">
          {ALLERGENS.map(allergen => {
            const on = selected.includes(allergen.key);
            return (
              <button
                key={allergen.key}
                type="button"
                aria-pressed={on}
                data-testid={`restriction-${allergen.key}`}
                onClick={() => setSelected(prev => (on ? prev.filter(key => key !== allergen.key) : [...prev, allergen.key]))}
                className={cn('px-3.5 py-2 rounded-full text-sm border transition-colors', on ? 'border-error bg-error-bg text-error font-medium' : 'border-border bg-card text-muted-foreground hover:border-foreground')}
              >
                {on && <Check size={12} className="inline mr-1 -mt-0.5" />}
                {allergen.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">As informações de alérgenos são cadastradas pelo restaurante. Em caso de alergia grave, confirme sempre com a equipe.</p>
      </div>
      <FixedBottom aboveNav>
        <button onClick={() => void save()} disabled={!changed || saving} className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl disabled:opacity-50">
          {saving ? 'Salvando…' : 'Salvar restrições'}
        </button>
      </FixedBottom>
    </div>
  );
}

// ─── Avisos in-app ──────────────────────────────────────────────────────────

const NOTIFICATION_ICON: Partial<Record<AppNotificationDto['kind'], typeof Bell>> = { booking_confirmed: CalendarCheck, booking_refused: CalendarCheck, booking_cancelled: CalendarCheck, review_request: Star };

export function NotificationsScreen() {
  const { go, openOrder } = useClient();
  const query = useNotifications(true);
  const data = query.data;

  function open(notification: AppNotificationDto) {
    void markNotificationsRead([notification.id]);
    if (notification.kind === 'review_request' && notification.refId) openOrder(notification.refId, 'review');
    else if (notification.kind.startsWith('booking_')) go('reservations');
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-24">
      <ScreenHeader
        title="Notificações"
        onBack={() => go('profile')}
        right={data && data.unread > 0 ? <button onClick={() => void markNotificationsRead()} className="text-primary text-xs font-medium">Marcar todas como lidas</button> : undefined}
      />
      <div className="px-5 py-5 flex flex-col gap-2">
        {query.error && !data ? (
          <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
        ) : !data ? (
          <LoadingBlock />
        ) : data.items.length === 0 ? (
          <p data-testid="notifications-empty" className="text-sm text-muted-foreground text-center py-10">Você não tem notificações.</p>
        ) : (
          data.items.map(notification => {
            const Icon = NOTIFICATION_ICON[notification.kind] ?? Bell;
            return (
              <button
                key={notification.id}
                data-testid="notification"
                data-kind={notification.kind}
                onClick={() => open(notification)}
                className={cn('bg-card border rounded-xl p-4 text-left flex gap-3', notification.read ? 'border-border' : 'border-primary/40 bg-primary/5')}
              >
                <Icon size={16} className={cn('mt-0.5 flex-shrink-0', notification.read ? 'text-muted-foreground' : 'text-primary')} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{notification.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{notification.body}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{formatDateTime(notification.createdAt)}</p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Avaliar pedido (ficha 48) ──────────────────────────────────────────────

export function ReviewScreen() {
  const { go, orderId, showToast } = useClient();
  const orderQuery = useOrder(orderId);
  const order = orderQuery.data;
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  if (!orderId) return null;
  if (!order) return orderQuery.error ? <ErrorBlock error={orderQuery.error} onRetry={() => void orderQuery.refetch()} /> : <LoadingBlock className="min-h-screen" />;

  async function submit() {
    if (!orderId || rating < 1) return;
    setSaving(true);
    try {
      await reviewOrder(orderId, { rating, ...(comment.trim() && { comment: comment.trim() }) });
      showToast('Obrigado pela avaliação!');
      go('orders');
    } catch (failure) {
      showToast(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-28">
      <ScreenHeader title="Avaliar pedido" onBack={() => go('orders')} />
      <div className="px-5 py-6 flex flex-col gap-5">
        <div>
          <p className="font-display font-bold text-foreground text-lg">{order.establishmentName}</p>
          <p className="text-sm text-muted-foreground">Pedido #{order.number} · {order.items.map(item => item.name).join(', ')}</p>
        </div>
        {!order.canReview ? (
          <p data-testid="review-done" className="text-sm text-muted-foreground bg-card border border-border rounded-xl px-4 py-4">
            {order.reviewRating ? `Você avaliou este pedido com ${order.reviewRating} ${order.reviewRating === 1 ? 'estrela' : 'estrelas'}. Obrigado!` : 'Você pode avaliar o pedido depois de retirá-lo.'}
          </p>
        ) : (
          <>
            <div role="radiogroup" aria-label="Nota" className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map(star => (
                <button key={star} role="radio" aria-checked={rating === star} aria-label={`${star} ${star === 1 ? 'estrela' : 'estrelas'}`} data-testid={`star-${star}`} onClick={() => setRating(star)} className="p-1">
                  <Star size={36} className={star <= rating ? 'fill-primary text-primary' : 'text-border fill-border'} />
                </button>
              ))}
            </div>
            <div>
              <label htmlFor="review-comment" className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2 block">Comentário (opcional)</label>
              <textarea id="review-comment" value={comment} onChange={event => setComment(event.target.value.slice(0, 500))} rows={4} placeholder="Conte como foi sua experiência…" className="w-full bg-muted rounded-xl px-4 py-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              <p className="text-[11px] text-muted-foreground text-right mt-1">{comment.length}/500</p>
            </div>
          </>
        )}
      </div>
      {order.canReview && (
        <FixedBottom aboveNav>
          <button onClick={() => void submit()} disabled={rating < 1 || saving} className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl disabled:opacity-50">
            {saving ? 'Enviando…' : 'Enviar avaliação'}
          </button>
        </FixedBottom>
      )}
    </div>
  );
}

// ─── Reservar mesa com data e horário (ficha 30) ────────────────────────────

const toDateInput = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function BookingScreen() {
  const { go, establishmentId, account, showToast } = useClient();
  const restaurant = useRestaurant(establishmentId).data;
  const today = useMemo(() => new Date(), []);
  const [date, setDate] = useState(toDateInput(today));
  const [partySize, setPartySize] = useState(2);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<BookingDto | null>(null);
  const slots = useBookingSlots(establishmentId, date, partySize);
  const maxDate = toDateInput(new Date(today.getTime() + BOOKING_MAX_DAYS_AHEAD * 86_400_000));

  if (!account) return null;
  if (!restaurant) return <LoadingBlock className="min-h-screen" />;

  async function submit() {
    if (!startsAt || !establishmentId) return;
    setSaving(true);
    try {
      setResult(await createBooking({ establishmentId, startsAt, partySize }));
      setStartsAt(null);
    } catch (failure) {
      showToast(errorMessage(failure));
      void slots.refetch();
    } finally {
      setSaving(false);
    }
  }

  const available = slots.data?.slots.filter(slot => slot.available).length ?? 0;
  return (
    <div className="min-h-screen bg-background flex flex-col pb-28">
      <ScreenHeader title="Reservar mesa" onBack={() => go('restaurant-detail')} />
      <div className="px-5 py-5 flex flex-col gap-5">
        <p className="font-display font-bold text-foreground">{restaurant.name}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="booking-date" className="block text-sm font-medium text-foreground mb-1.5">Data</label>
            <input id="booking-date" data-testid="booking-date" type="date" value={date} min={toDateInput(today)} max={maxDate} onChange={event => { setDate(event.target.value); setStartsAt(null); }} className="w-full bg-card border border-border rounded-xl px-3 py-3 text-sm text-foreground focus:outline-none focus:border-primary" />
          </div>
          <div>
            <p className="block text-sm font-medium text-foreground mb-1.5">Pessoas</p>
            <div className="flex items-center justify-between bg-card border border-border rounded-xl px-3 py-2.5">
              <button aria-label="Menos uma pessoa" disabled={partySize <= 1} onClick={() => { setPartySize(partySize - 1); setStartsAt(null); }} className="p-1 text-primary disabled:opacity-40"><Minus size={16} /></button>
              <span data-testid="booking-party" className="font-display font-bold">{partySize}</span>
              <button aria-label="Mais uma pessoa" disabled={partySize >= BOOKING_MAX_PARTY} onClick={() => { setPartySize(partySize + 1); setStartsAt(null); }} className="p-1 text-primary disabled:opacity-40"><Plus size={16} /></button>
            </div>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-foreground mb-2">Horário</p>
          {slots.error ? (
            <ErrorBlock error={slots.error} onRetry={() => void slots.refetch()} className="py-6" />
          ) : !slots.data ? (
            <LoadingBlock className="py-6" />
          ) : slots.data.slots.length === 0 ? (
            <p className="text-sm text-muted-foreground bg-card border border-border rounded-xl px-4 py-4 text-center">O restaurante não abre nesta data.</p>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Horários">
                {slots.data.slots.map(slot => (
                  <button
                    key={slot.startsAt}
                    role="radio"
                    aria-checked={startsAt === slot.startsAt}
                    data-testid={`slot-${slot.label}`}
                    disabled={!slot.available}
                    onClick={() => setStartsAt(slot.startsAt)}
                    className={cn('py-2.5 rounded-lg text-sm border transition-colors', startsAt === slot.startsAt ? 'border-primary bg-primary text-primary-foreground font-medium' : slot.available ? 'border-border bg-card text-foreground' : 'border-border bg-muted text-muted-foreground line-through opacity-60')}
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
              {available === 0 && <p className="text-xs text-muted-foreground mt-2">Sem horários livres para {partySize} {partySize === 1 ? 'pessoa' : 'pessoas'} nesta data. Tente outra data ou outro tamanho de grupo.</p>}
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">A reserva é confirmada ou recusada na hora, conforme as mesas livres, e a mesa fica reservada por 90 minutos.</p>
      </div>
      <FixedBottom aboveNav>
        <button onClick={() => void submit()} disabled={!startsAt || saving} data-testid="booking-submit" className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl disabled:opacity-50">
          {saving ? 'Reservando…' : 'Reservar mesa'}
        </button>
      </FixedBottom>

      {result && (
        <BottomSheet onClose={() => setResult(null)}>
          <div data-testid="booking-result" data-status={result.status} className="flex flex-col items-center text-center gap-3">
            <div className={cn('w-14 h-14 rounded-2xl flex items-center justify-center', result.status === 'confirmed' ? 'bg-success-bg' : 'bg-error-bg')}>
              {result.status === 'confirmed' ? <Check size={28} className="text-success" /> : <X size={28} className="text-error" />}
            </div>
            <p className="font-display font-bold text-foreground text-lg">{result.status === 'confirmed' ? 'Reserva confirmada!' : 'Não foi possível reservar'}</p>
            <p className="text-sm text-muted-foreground">
              {result.status === 'confirmed'
                ? `${formatDateTimeIn(result.startsAt, result.timezone)} · ${result.partySize} ${result.partySize === 1 ? 'pessoa' : 'pessoas'}${result.tableLabel ? ` · ${result.tableLabel}` : ''}`
                : result.refusalReason}
            </p>
            {result.status === 'confirmed' ? (
              <button onClick={() => go('reservations')} className="w-full bg-primary text-primary-foreground font-display font-semibold py-3.5 rounded-xl">Ver minhas reservas</button>
            ) : (
              <button onClick={() => setResult(null)} className="w-full bg-primary text-primary-foreground font-display font-semibold py-3.5 rounded-xl">Escolher outro horário</button>
            )}
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

/** Lista de reservas com data e horário (perfil), com cancelamento enquanto confirmada e futura. */
export function BookingList({ bookings, onChanged }: { bookings: BookingDto[]; onChanged?: () => void }) {
  const { showToast } = useClient();
  const [cancelling, setCancelling] = useState<string | null>(null);
  async function cancel(id: string) {
    setCancelling(id);
    try {
      await cancelMyBooking(id);
      showToast('Reserva cancelada');
      onChanged?.();
    } catch (failure) {
      showToast(errorMessage(failure));
    } finally {
      setCancelling(null);
    }
  }
  return (
    <div className="flex flex-col gap-3">
      {bookings.map(booking => (
        <div key={booking.id} data-testid="booking" data-status={booking.status} className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display font-bold text-foreground">{booking.establishmentName}</p>
            <span data-testid="booking-status" className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full', booking.status === 'confirmed' || booking.status === 'seated' ? 'bg-success-bg text-success' : 'bg-error-bg text-error')}>{BOOKING_STATUS_LABELS[booking.status]}</span>
          </div>
          <p className="text-sm text-foreground">{formatDateTimeIn(booking.startsAt, booking.timezone)} · {booking.partySize} {booking.partySize === 1 ? 'pessoa' : 'pessoas'}{booking.tableLabel ? ` · ${booking.tableLabel}` : ''}</p>
          {booking.refusalReason && <p className="text-xs text-error">{booking.refusalReason}</p>}
          {booking.status === 'confirmed' && new Date(booking.startsAt) > new Date() && (
            <button onClick={() => void cancel(booking.id)} disabled={cancelling === booking.id} className="text-error text-xs font-medium self-start mt-1 disabled:opacity-60">Cancelar reserva</button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Aviso de restrição alimentar: o servidor guarda; aqui só se mostra. */
export function RestrictionNotice({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div role="alert" data-testid="allergen-warning" className="flex items-start gap-2 bg-error-bg border border-error/30 rounded-xl px-4 py-3">
      <ShieldAlert size={16} className="text-error flex-shrink-0 mt-0.5" />
      <p className="text-sm text-error"><strong>Atenção:</strong> contém {names.join(', ')}, que você marcou como restrição.</p>
    </div>
  );
}
