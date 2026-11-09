import { useState, type FormEvent } from 'react';
import { CalendarX2, Plus, Trash2 } from 'lucide-react';
import { EXPIRY_ALERT_MAX_DAYS, EXPIRY_ALERT_MIN_DAYS, type IngredientLotDto } from '@filafacil/shared';
import EmptyState from '@/components/ui/EmptyState';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn } from '@/lib/utils';
import { useIngredients } from '@/services/recipeService';
import { closeIngredientLot, createIngredientLot, deleteIngredientLot, saveExpirySettings, useExpirySettings, useIngredientLots } from '@/services/sprint4StaffService';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { ManagerSectionProps } from '../../types';

const STATE: Record<IngredientLotDto['state'], { label: string; className: string }> = {
  ok: { label: 'Dentro do prazo', className: 'bg-success-bg text-success' },
  expiring: { label: 'Perto de vencer', className: 'bg-warning-bg text-warning' },
  expired: { label: 'Vencido', className: 'bg-error-bg text-error' },
  closed: { label: 'Usado/descartado', className: 'bg-muted text-muted-foreground' },
};

const brDate = (iso: string) => iso.split('-').reverse().join('/');
const daysLabel = (days: number) => (days < 0 ? `venceu há ${-days} ${-days === 1 ? 'dia' : 'dias'}` : days === 0 ? 'vence hoje' : days === 1 ? 'vence amanhã' : `vence em ${days} dias`);

/** Ficha 70: validade por lote, alerta antecipado e sugestão de pratos para usar o insumo antes do vencimento. */
export default function ExpirySection({ unit, notify }: ManagerSectionProps) {
  const lots = useIngredientLots(unit.id);
  const settings = useExpirySettings(unit.id);
  const { run } = useAsyncAction(notify);
  const [adding, setAdding] = useState(false);
  const [discarding, setDiscarding] = useState<IngredientLotDto | null>(null);
  const [days, setDays] = useState<string | null>(null);

  if (lots.error && !lots.data) return <ErrorBlock error={lots.error} onRetry={() => void lots.refetch()} />;
  if (!lots.data) return <LoadingBlock />;
  const alertDays = days ?? String(settings.data?.alertDays ?? '');
  const validDays = Number.isInteger(Number(alertDays)) && Number(alertDays) >= EXPIRY_ALERT_MIN_DAYS && Number(alertDays) <= EXPIRY_ALERT_MAX_DAYS;
  const changedDays = settings.data && String(settings.data.alertDays) !== alertDays;

  return (
    <div className="p-6 flex flex-col gap-4 max-w-5xl">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label htmlFor="alert-days" className="text-xs text-muted-foreground font-medium block mb-1">Avisar com antecedência de (dias)</label>
          <div className="flex gap-2">
            <input id="alert-days" data-testid="alert-days" value={alertDays} onChange={event => setDays(event.target.value)} inputMode="numeric" className="border border-border rounded-xl px-3 py-2 text-sm bg-card w-24" />
            <button disabled={!changedDays || !validDays} onClick={() => void run(() => saveExpirySettings(unit.id, Number(alertDays)).then(() => setDays(null)), 'Antecedência atualizada')} className="border border-border rounded-xl px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">Salvar</button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">De {EXPIRY_ALERT_MIN_DAYS} a {EXPIRY_ALERT_MAX_DAYS} dias. O alerta chega ao painel assim que o lote entra na janela.</p>
        </div>
        <button onClick={() => setAdding(true)} data-testid="add-lot" className="ml-auto flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium"><Plus size={15} />Cadastrar lote</button>
      </div>

      {lots.data.length === 0 ? (
        <div className="bg-card rounded-xl border border-border"><EmptyState icon={CalendarX2} title="Nenhum lote cadastrado" description="Cadastre a data de validade de cada lote de ingrediente para ser avisado antes de vencer." /></div>
      ) : (
        <div className="flex flex-col gap-3">
          {lots.data.map(lot => (
            <div key={lot.id} data-testid="lot-row" data-state={lot.state} className={cn('bg-card rounded-xl border p-5 flex items-center justify-between gap-4', lot.state === 'expired' ? 'border-error/40' : lot.state === 'expiring' ? 'border-warning/40' : 'border-border', lot.state === 'closed' && 'opacity-60')}>
              <div className="min-w-0 flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-display font-semibold text-foreground">{lot.ingredientName} · lote {lot.code}</p>
                  <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', STATE[lot.state].className)}>{STATE[lot.state].label}</span>
                </div>
                <p className="text-sm text-muted-foreground">Validade {brDate(lot.expiresOn)}{lot.state !== 'closed' && ` · ${daysLabel(lot.daysLeft)}`}{lot.quantity && ` · ${Number(lot.quantity)} ${lot.unit}`}</p>
                {lot.state !== 'closed' && lot.dishes.length > 0 && (
                  <p data-testid="lot-dishes" className="text-xs text-foreground">Priorize: {lot.dishes.map(dish => dish.name).join(', ')}</p>
                )}
              </div>
              {lot.state !== 'closed' && (
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => void run(() => closeIngredientLot(unit.id, lot.id), 'Lote encerrado — alerta fechado')} className="text-xs font-semibold border border-border rounded-lg px-3 py-1.5 hover:bg-muted">Usado/descartado</button>
                  <button onClick={() => setDiscarding(lot)} aria-label={`Remover lote ${lot.code}`} className="p-2 hover:bg-error-bg rounded-lg text-muted-foreground hover:text-error"><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {adding && <LotModal unitId={unit.id} notify={notify} onClose={() => setAdding(false)} />}
      {discarding && <ConfirmDialog title="Remover lote" message={`Remove o lote ${discarding.code} de ${discarding.ingredientName} (cadastrado por engano). Para lotes usados ou descartados, use “Usado/descartado”.`} confirmLabel="Remover lote" onConfirm={() => run(() => deleteIngredientLot(unit.id, discarding.id), 'Lote removido')} onClose={() => setDiscarding(null)} />}
    </div>
  );
}

function LotModal({ unitId, notify, onClose }: { unitId: string; notify: (message: string) => void; onClose: () => void }) {
  const ingredients = useIngredients(unitId).data ?? [];
  const { run, pending } = useAsyncAction(notify);
  const [ingredientId, setIngredientId] = useState('');
  const [code, setCode] = useState('');
  const [quantity, setQuantity] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!ingredientId) next.ingredient = 'Escolha o insumo.';
    if (!code.trim()) next.code = 'Informe o código do lote.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) next.expiresOn = 'Informe a data de validade.';
    if (quantity && !(Number(quantity.replace(',', '.')) >= 0)) next.quantity = 'Quantidade inválida.';
    setErrors(next);
    if (Object.keys(next).length) return;
    const saved = await run(() => createIngredientLot(unitId, { ingredientId, code: code.trim(), quantity: quantity ? Number(quantity.replace(',', '.')) : null, expiresOn }), 'Lote cadastrado');
    if (saved) onClose();
  }

  return (
    <Modal title="Cadastrar lote" onClose={onClose}>
      <form onSubmit={event => void submit(event)} className="flex flex-col gap-4" noValidate>
        <FormField label="Insumo" htmlFor="lot-ingredient" error={errors.ingredient}>
          <select id="lot-ingredient" value={ingredientId} onChange={event => setIngredientId(event.target.value)} className={PANEL_INPUT_CLASS}>
            <option value="">Escolha…</option>
            {ingredients.map(ingredient => <option key={ingredient.id} value={ingredient.id}>{ingredient.name} ({ingredient.unit})</option>)}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Código do lote" htmlFor="lot-code" error={errors.code}><input id="lot-code" value={code} onChange={event => setCode(event.target.value)} maxLength={40} className={PANEL_INPUT_CLASS} /></FormField>
          <FormField label="Quantidade (opcional)" htmlFor="lot-quantity" error={errors.quantity}><input id="lot-quantity" value={quantity} onChange={event => setQuantity(event.target.value)} inputMode="decimal" className={PANEL_INPUT_CLASS} /></FormField>
        </div>
        <FormField label="Validade" htmlFor="lot-expires" error={errors.expiresOn}><input id="lot-expires" type="date" value={expiresOn} onChange={event => setExpiresOn(event.target.value)} className={PANEL_INPUT_CLASS} /></FormField>
        <div className="flex gap-3 mt-1">
          <button type="button" onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">Cancelar</button>
          <button type="submit" disabled={pending} className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60">{pending ? 'Salvando…' : 'Cadastrar'}</button>
        </div>
      </form>
    </Modal>
  );
}
