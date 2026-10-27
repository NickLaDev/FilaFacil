import { useState, type FormEvent } from 'react';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import { errorMessage } from '@/lib/api/client';
import { updateIngredientStock } from '@/services/operationsService';
import type { IngredientView } from '@/services/recipeService';

interface Props {
  establishmentId: string;
  ingredient: IngredientView;
  notify: (message: string) => void;
  onClose: () => void;
}

/** Ficha 50: estoque atual e mínimo do insumo (vazio = sem controle de estoque). */
export default function StockModal({ establishmentId, ingredient, notify, onClose }: Props) {
  const [stock, setStock] = useState(ingredient.stockQuantity ?? '');
  const [min, setMin] = useState(ingredient.minStockQuantity);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const stockValue = stock.trim() === '' ? null : Number(stock.replace(',', '.'));
    const minValue = min.trim() === '' ? 0 : Number(min.replace(',', '.'));
    if ((stockValue !== null && (!Number.isFinite(stockValue) || stockValue < 0)) || !Number.isFinite(minValue) || minValue < 0) {
      setError('Informe quantidades válidas (zero ou mais).');
      return;
    }
    setSaving(true);
    try {
      await updateIngredientStock(establishmentId, ingredient.id, { stockQuantity: stockValue, minStockQuantity: minValue });
      notify(`Estoque de ${ingredient.name} atualizado`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Estoque de ${ingredient.name}`} onClose={onClose}>
      <form onSubmit={event => void submit(event)} className="flex flex-col gap-4" noValidate>
        <FormField label={`Estoque atual (${ingredient.unit})`} htmlFor="stock-qty" hint="Deixe vazio para não controlar o estoque.">
          <input id="stock-qty" inputMode="decimal" value={stock} onChange={e => setStock(e.target.value)} className={PANEL_INPUT_CLASS} />
        </FormField>
        <FormField label={`Estoque mínimo (${ingredient.unit})`} htmlFor="stock-min" hint="Ao chegar nesse valor a equipe recebe um alerta.">
          <input id="stock-min" inputMode="decimal" value={min} onChange={e => setMin(e.target.value)} className={PANEL_INPUT_CLASS} />
        </FormField>
        {error && <p className="text-error text-sm">{error}</p>}
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">Cancelar</button>
          <button type="submit" disabled={saving} className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60">{saving ? 'Salvando…' : 'Salvar estoque'}</button>
        </div>
      </form>
    </Modal>
  );
}
