import { useState, type FormEvent } from 'react';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import { cn, formatCurrency } from '@/lib/utils';
import type { PromotionDto } from '@filafacil/shared';
import { useAsyncAction } from '@/lib/useAsyncAction';
import type { MenuItemView } from '@/services/menuService';
import { applyDiscount, savePromotion } from '@/services/promotionService';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DISCOUNT = 1;
const MAX_DISCOUNT = 90;

/** Converte para o formato do <input type="datetime-local"> no fuso local. */
function toDateTimeLocal(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface Props {
  establishmentId: string;
  promotion?: PromotionDto;
  items: MenuItemView[];
  notify: (message: string) => void;
  onClose: () => void;
}

type Errors = Partial<Record<'name' | 'items' | 'discount' | 'period', string>>;

export default function PromotionFormModal({ establishmentId, promotion, items, notify, onClose }: Props) {
  const { run, pending } = useAsyncAction(notify);
  const [name, setName] = useState(promotion?.name ?? '');
  const [itemIds, setItemIds] = useState<string[]>(promotion?.itemIds ?? []);
  const [discount, setDiscount] = useState(String(promotion?.discountPercent ?? 10));
  const [startsAt, setStartsAt] = useState(() => toDateTimeLocal(promotion ? new Date(promotion.startsAt) : new Date()));
  const [endsAt, setEndsAt] = useState(() => toDateTimeLocal(promotion ? new Date(promotion.endsAt) : new Date(Date.now() + 7 * DAY_MS)));
  const [errors, setErrors] = useState<Errors>({});

  const parsedDiscount = Number(discount);
  const validDiscount = Number.isInteger(parsedDiscount) && parsedDiscount >= MIN_DISCOUNT && parsedDiscount <= MAX_DISCOUNT;

  function toggleItem(id: string) {
    setItemIds(prev => (prev.includes(id) ? prev.filter(itemId => itemId !== id) : [...prev, id]));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    const nextErrors: Errors = {};
    if (!name.trim()) nextErrors.name = 'Dê um nome para a promoção.';
    if (itemIds.length === 0) nextErrors.items = 'Escolha pelo menos um item.';
    if (!validDiscount) nextErrors.discount = `Use um número inteiro entre ${MIN_DISCOUNT} e ${MAX_DISCOUNT}.`;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) nextErrors.period = 'Informe início e fim.';
    else if (end <= start) nextErrors.period = 'O fim precisa ser depois do início.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    // O horário digitado está no fuso do navegador; a API recebe e guarda em UTC.
    const saved = await run(
      () =>
        savePromotion(
          establishmentId,
          { name: name.trim(), itemIds, discountPercent: parsedDiscount, startsAt: start.toISOString(), endsAt: end.toISOString() },
          promotion?.id,
        ),
      promotion ? `Promoção ${name.trim()} atualizada` : `Promoção ${name.trim()} criada`,
    );
    if (saved) onClose();
  }

  return (
    <Modal title={promotion ? 'Editar promoção' : 'Nova promoção'} onClose={onClose} width="md">
      <form onSubmit={event => void handleSubmit(event)} className="flex flex-col gap-4" noValidate>
        <FormField label="Nome" htmlFor="promo-name" error={errors.name}>
          <input id="promo-name" value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="Ex: Happy Hour" className={PANEL_INPUT_CLASS} />
        </FormField>

        <FormField label="Itens com desconto" error={errors.items}>
          <div className="border border-border rounded-xl max-h-48 overflow-y-auto divide-y divide-border">
            {items.map(item => {
              const checked = itemIds.includes(item.id);
              return (
                <label key={item.id} className={cn('flex items-center gap-3 px-3 py-2.5 cursor-pointer', checked && 'bg-primary/5')}>
                  <input type="checkbox" checked={checked} onChange={() => toggleItem(item.id)} className="w-4 h-4 accent-primary" />
                  <span className="text-sm text-foreground flex-1">{item.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatCurrency(item.price)}
                    {checked && validDiscount && <span className="text-success font-medium"> → {formatCurrency(applyDiscount(item.price, parsedDiscount))}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </FormField>

        <FormField label="Desconto (%)" htmlFor="promo-discount" error={errors.discount}>
          <input id="promo-discount" type="number" min={MIN_DISCOUNT} max={MAX_DISCOUNT} step={1} value={discount} onChange={e => setDiscount(e.target.value)} className={PANEL_INPUT_CLASS} />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Início" htmlFor="promo-start">
            <input id="promo-start" type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} className={PANEL_INPUT_CLASS} />
          </FormField>
          <FormField label="Fim" htmlFor="promo-end">
            <input id="promo-end" type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} className={PANEL_INPUT_CLASS} />
          </FormField>
        </div>
        {errors.period && <p className="text-error text-xs -mt-2">{errors.period}</p>}
        <p className="text-xs text-muted-foreground -mt-1">A promoção entra e sai do cardápio do cliente automaticamente neste período.</p>

        <div className="flex gap-3 mt-1">
          <button type="button" onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">
            Cancelar
          </button>
          <button type="submit" disabled={pending} className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60">
            {promotion ? 'Salvar alterações' : 'Criar promoção'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
