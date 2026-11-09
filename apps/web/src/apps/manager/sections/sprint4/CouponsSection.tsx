import { useState, type FormEvent } from 'react';
import { Edit3, Plus, Tag, Trash2, Wallet } from 'lucide-react';
import { CASHBACK_MAX_PERCENT, COUPON_CODE_PATTERN, type CashbackRuleDto, type CouponDto, type CouponState } from '@filafacil/shared';
import EmptyState from '@/components/ui/EmptyState';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import Toggle from '@/components/ui/Toggle';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatCents, formatDateTime } from '@/lib/utils';
import { usePromotions } from '@/services/promotionService';
import { deleteCashbackRule, deleteCoupon, saveCashbackRule, saveCoupon, useCashbackRules, useCoupons } from '@/services/sprint4StaffService';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { ManagerSectionProps } from '../../types';

const STATE_BADGE: Record<CouponState, { label: string; className: string }> = {
  active: { label: 'Ativo', className: 'bg-success-bg text-success' },
  scheduled: { label: 'Agendado', className: 'bg-warning-bg text-warning' },
  expired: { label: 'Expirado', className: 'bg-muted text-muted-foreground' },
  inactive: { label: 'Desativado', className: 'bg-muted text-muted-foreground' },
  exhausted: { label: 'Esgotado', className: 'bg-error-bg text-error' },
};

const DAY_MS = 86_400_000;
const toLocalInput = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** Fichas 56 e 15: cupons de campanha e regras de cashback do estabelecimento. */
export default function CouponsSection({ unit, notify }: ManagerSectionProps) {
  const [tab, setTab] = useState<'coupons' | 'cashback'>('coupons');
  return (
    <div className="p-6 flex flex-col gap-4">
      <div role="tablist" className="flex gap-2">
        {([['coupons', 'Cupons', Tag], ['cashback', 'Cashback', Wallet]] as const).map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium', tab === id ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:text-foreground')}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>
      {tab === 'coupons' ? <CouponsTab unitId={unit.id} notify={notify} /> : <CashbackTab unitId={unit.id} notify={notify} />}
    </div>
  );
}

function CouponsTab({ unitId, notify }: { unitId: string; notify: (message: string) => void }) {
  const query = useCoupons(unitId);
  const { run } = useAsyncAction(notify);
  const [editing, setEditing] = useState<CouponDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CouponDto | null>(null);
  if (query.error && !query.data) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingBlock />;
  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">O cliente digita o código no checkout. Cada cupom vale uma vez por cliente e é recusado se estiver fora do prazo.</p>
        <button onClick={() => setEditing('new')} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium"><Plus size={15} />Novo cupom</button>
      </div>
      {query.data.length === 0 ? (
        <div className="bg-card rounded-xl border border-border"><EmptyState icon={Tag} title="Nenhum cupom" description="Crie cupons para campanhas de marketing (ex.: BEMVINDO10)." /></div>
      ) : (
        <div className="flex flex-col gap-3">
          {query.data.map(coupon => (
            <div key={coupon.id} data-testid="coupon-row" className="bg-card rounded-xl border border-border p-5 flex items-center justify-between gap-4">
              <div className="min-w-0 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <p className="font-mono font-bold text-foreground">{coupon.code}</p>
                  <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', STATE_BADGE[coupon.state].className)}>{STATE_BADGE[coupon.state].label}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {coupon.discountType === 'percent' ? `${coupon.discountValue}% de desconto` : `${formatCents(coupon.discountValue)} de desconto`}
                  {coupon.minOrderCents > 0 && ` · pedido mínimo ${formatCents(coupon.minOrderCents)}`}
                  {coupon.description && ` · ${coupon.description}`}
                </p>
                <p className="text-xs text-muted-foreground">{formatDateTime(coupon.startsAt)} até {formatDateTime(coupon.endsAt)} · {coupon.usedCount}{coupon.maxUses ? ` de ${coupon.maxUses}` : ''} {coupon.usedCount === 1 ? 'uso' : 'usos'}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Toggle checked={coupon.active} onChange={active => void run(() => saveCoupon(unitId, { code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue, startsAt: coupon.startsAt, endsAt: coupon.endsAt, active }, coupon.id), active ? 'Cupom ativado' : 'Cupom desativado')} label={`Ativar ${coupon.code}`} tone="success" />
                <button onClick={() => setEditing(coupon)} aria-label={`Editar ${coupon.code}`} className="p-2 hover:bg-muted rounded-lg text-muted-foreground"><Edit3 size={15} /></button>
                <button onClick={() => setDeleting(coupon)} aria-label={`Excluir ${coupon.code}`} className="p-2 hover:bg-error-bg rounded-lg text-muted-foreground hover:text-error"><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <CouponFormModal unitId={unitId} coupon={editing === 'new' ? undefined : editing} notify={notify} onClose={() => setEditing(null)} />}
      {deleting && <ConfirmDialog title="Excluir cupom" message={`O cupom ${deleting.code} será excluído. Cupons já usados não podem ser excluídos — desative-os.`} confirmLabel="Excluir cupom" onConfirm={() => run(() => deleteCoupon(unitId, deleting.id), 'Cupom excluído')} onClose={() => setDeleting(null)} />}
    </>
  );
}

function CouponFormModal({ unitId, coupon, notify, onClose }: { unitId: string; coupon?: CouponDto; notify: (message: string) => void; onClose: () => void }) {
  const { run, pending } = useAsyncAction(notify);
  const [code, setCode] = useState(coupon?.code ?? '');
  const [description, setDescription] = useState(coupon?.description ?? '');
  const [type, setType] = useState<'percent' | 'fixed'>(coupon?.discountType ?? 'percent');
  const [value, setValue] = useState(coupon ? String(coupon.discountType === 'fixed' ? (coupon.discountValue / 100).toFixed(2).replace('.', ',') : coupon.discountValue) : '10');
  const [minOrder, setMinOrder] = useState(coupon ? (coupon.minOrderCents / 100).toFixed(2).replace('.', ',') : '');
  const [maxUses, setMaxUses] = useState(coupon?.maxUses ? String(coupon.maxUses) : '');
  const [startsAt, setStartsAt] = useState(() => toLocalInput(coupon ? new Date(coupon.startsAt) : new Date()));
  const [endsAt, setEndsAt] = useState(() => toLocalInput(coupon ? new Date(coupon.endsAt) : new Date(Date.now() + 30 * DAY_MS)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const money = (text: string) => Math.round(Number(text.replace(',', '.')) * 100);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    const normalized = code.trim().toUpperCase();
    if (!coupon && !COUPON_CODE_PATTERN.test(normalized)) next.code = 'Use de 3 a 32 letras, números, hífen ou sublinhado.';
    const amount = type === 'percent' ? Number(value) : money(value);
    if (!Number.isFinite(amount) || amount <= 0 || (type === 'percent' && (amount > 100 || !Number.isInteger(amount)))) next.value = type === 'percent' ? 'Informe um percentual inteiro de 1 a 100.' : 'Informe um valor válido.';
    if (minOrder && !Number.isFinite(money(minOrder))) next.minOrder = 'Valor inválido.';
    if (maxUses && !(Number.isInteger(Number(maxUses)) && Number(maxUses) > 0)) next.maxUses = 'Informe um número inteiro maior que zero.';
    if (new Date(endsAt) <= new Date(startsAt)) next.period = 'O fim precisa ser depois do início.';
    setErrors(next);
    if (Object.keys(next).length) return;
    const saved = await run(
      () => saveCoupon(unitId, { code: normalized, description: description.trim(), discountType: type, discountValue: amount, minOrderCents: minOrder ? money(minOrder) : 0, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), maxUses: maxUses ? Number(maxUses) : null }, coupon?.id),
      coupon ? 'Cupom atualizado' : 'Cupom criado',
    );
    if (saved) onClose();
  }

  return (
    <Modal title={coupon ? `Editar ${coupon.code}` : 'Novo cupom'} onClose={onClose} width="md">
      <form onSubmit={event => void submit(event)} className="flex flex-col gap-4" noValidate>
        <FormField label="Código" htmlFor="coupon-code-field" error={errors.code} hint={coupon ? 'O código não pode ser alterado.' : undefined}>
          <input id="coupon-code-field" value={code} onChange={event => setCode(event.target.value.toUpperCase())} disabled={Boolean(coupon)} maxLength={32} placeholder="BEMVINDO10" className={cn(PANEL_INPUT_CLASS, 'font-mono')} />
        </FormField>
        <FormField label="Descrição (opcional)" htmlFor="coupon-description"><input id="coupon-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={120} className={PANEL_INPUT_CLASS} /></FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Tipo" htmlFor="coupon-type"><select id="coupon-type" value={type} onChange={event => setType(event.target.value as 'percent' | 'fixed')} className={PANEL_INPUT_CLASS}><option value="percent">Percentual (%)</option><option value="fixed">Valor fixo (R$)</option></select></FormField>
          <FormField label={type === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'} htmlFor="coupon-value" error={errors.value}><input id="coupon-value" value={value} onChange={event => setValue(event.target.value)} inputMode="decimal" className={PANEL_INPUT_CLASS} /></FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Pedido mínimo (R$)" htmlFor="coupon-min" error={errors.minOrder}><input id="coupon-min" value={minOrder} onChange={event => setMinOrder(event.target.value)} inputMode="decimal" placeholder="Sem mínimo" className={PANEL_INPUT_CLASS} /></FormField>
          <FormField label="Limite de usos" htmlFor="coupon-max" error={errors.maxUses}><input id="coupon-max" value={maxUses} onChange={event => setMaxUses(event.target.value)} inputMode="numeric" placeholder="Ilimitado" className={PANEL_INPUT_CLASS} /></FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Válido a partir de" htmlFor="coupon-start"><input id="coupon-start" type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} className={PANEL_INPUT_CLASS} /></FormField>
          <FormField label="Válido até" htmlFor="coupon-end" error={errors.period}><input id="coupon-end" type="datetime-local" value={endsAt} onChange={event => setEndsAt(event.target.value)} className={PANEL_INPUT_CLASS} /></FormField>
        </div>
        <div className="flex gap-3 mt-1">
          <button type="button" onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">Cancelar</button>
          <button type="submit" disabled={pending} className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60">{pending ? 'Salvando…' : coupon ? 'Salvar' : 'Criar cupom'}</button>
        </div>
      </form>
    </Modal>
  );
}

function CashbackTab({ unitId, notify }: { unitId: string; notify: (message: string) => void }) {
  const query = useCashbackRules(unitId);
  const { run } = useAsyncAction(notify);
  const [editing, setEditing] = useState<CashbackRuleDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CashbackRuleDto | null>(null);
  if (query.error && !query.data) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingBlock />;
  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">O cliente recebe a porcentagem de volta como saldo quando o pedido é entregue e pago. Vale a melhor regra ativa; regras de promoção só contam os itens da promoção.</p>
        <button onClick={() => setEditing('new')} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium"><Plus size={15} />Nova regra</button>
      </div>
      {query.data.length === 0 ? (
        <div className="bg-card rounded-xl border border-border"><EmptyState icon={Wallet} title="Nenhuma regra de cashback" description="Crie uma regra para devolver parte do valor aos clientes." /></div>
      ) : (
        <div className="flex flex-col gap-3">
          {query.data.map(rule => (
            <div key={rule.id} data-testid="cashback-rule" className={cn('bg-card rounded-xl border border-border p-5 flex items-center justify-between gap-4', !rule.active && 'opacity-60')}>
              <div>
                <p className="font-display font-semibold text-foreground">{rule.name} · {rule.percent}%</p>
                <p className="text-sm text-muted-foreground">{rule.promotionName ? `Só itens da promoção “${rule.promotionName}”` : 'Todo o pedido'}</p>
              </div>
              <div className="flex items-center gap-2">
                <Toggle checked={rule.active} onChange={active => void run(() => saveCashbackRule(unitId, { name: rule.name, percent: rule.percent, active }, rule.id), active ? 'Regra ativada' : 'Regra desativada')} label={`Ativar ${rule.name}`} tone="success" />
                <button onClick={() => setEditing(rule)} aria-label={`Editar ${rule.name}`} className="p-2 hover:bg-muted rounded-lg text-muted-foreground"><Edit3 size={15} /></button>
                <button onClick={() => setDeleting(rule)} aria-label={`Excluir ${rule.name}`} className="p-2 hover:bg-error-bg rounded-lg text-muted-foreground hover:text-error"><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <CashbackRuleModal unitId={unitId} rule={editing === 'new' ? undefined : editing} notify={notify} onClose={() => setEditing(null)} />}
      {deleting && <ConfirmDialog title="Excluir regra" message={`A regra “${deleting.name}” deixa de valer para novos pedidos. Pedidos já feitos mantêm o cashback combinado.`} confirmLabel="Excluir regra" onConfirm={() => run(() => deleteCashbackRule(unitId, deleting.id), 'Regra excluída')} onClose={() => setDeleting(null)} />}
    </>
  );
}

function CashbackRuleModal({ unitId, rule, notify, onClose }: { unitId: string; rule?: CashbackRuleDto; notify: (message: string) => void; onClose: () => void }) {
  const { run, pending } = useAsyncAction(notify);
  const promotions = usePromotions(unitId).data ?? [];
  const [name, setName] = useState(rule?.name ?? '');
  const [percent, setPercent] = useState(String(rule?.percent ?? 5));
  const [promotionId, setPromotionId] = useState(rule?.promotionId ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Dê um nome para a regra.';
    const value = Number(percent);
    if (!Number.isInteger(value) || value < 1 || value > CASHBACK_MAX_PERCENT) next.percent = `Use um número inteiro de 1 a ${CASHBACK_MAX_PERCENT}.`;
    setErrors(next);
    if (Object.keys(next).length) return;
    const saved = await run(() => saveCashbackRule(unitId, { name: name.trim(), percent: value, promotionId: promotionId || null }, rule?.id), rule ? 'Regra atualizada' : 'Regra criada');
    if (saved) onClose();
  }

  return (
    <Modal title={rule ? 'Editar regra de cashback' : 'Nova regra de cashback'} onClose={onClose}>
      <form onSubmit={event => void submit(event)} className="flex flex-col gap-4" noValidate>
        <FormField label="Nome" htmlFor="rule-name" error={errors.name}><input id="rule-name" value={name} onChange={event => setName(event.target.value)} maxLength={60} placeholder="Ex.: 5% em todo pedido" className={PANEL_INPUT_CLASS} /></FormField>
        <FormField label="Percentual devolvido (%)" htmlFor="rule-percent" error={errors.percent}><input id="rule-percent" value={percent} onChange={event => setPercent(event.target.value)} inputMode="numeric" className={PANEL_INPUT_CLASS} /></FormField>
        <FormField label="Vale para" htmlFor="rule-promotion" hint="Com uma promoção, só os itens dela rendem cashback, enquanto ela estiver vigente.">
          <select id="rule-promotion" value={promotionId} onChange={event => setPromotionId(event.target.value)} className={PANEL_INPUT_CLASS}>
            <option value="">Todo o pedido</option>
            {promotions.map(promotion => <option key={promotion.id} value={promotion.id}>Promoção: {promotion.name}</option>)}
          </select>
        </FormField>
        <div className="flex gap-3 mt-1">
          <button type="button" onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">Cancelar</button>
          <button type="submit" disabled={pending} className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60">{pending ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}
