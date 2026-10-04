import { useState, type FormEvent } from 'react';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import type { IngredientUnit } from '@filafacil/shared';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { saveIngredient, type IngredientView } from '@/services/recipeService';

const UNITS: { id: IngredientUnit; label: string }[] = [
  { id: 'un', label: 'Unidade (un)' },
  { id: 'kg', label: 'Quilo (kg)' },
  { id: 'g', label: 'Grama (g)' },
  { id: 'L', label: 'Litro (L)' },
  { id: 'ml', label: 'Mililitro (ml)' },
];
const MAX_UNIT_COST = 100_000;

interface Props {
  establishmentId: string;
  ingredient?: IngredientView;
  notify: (message: string) => void;
  onClose: () => void;
}

export default function IngredientFormModal({ establishmentId, ingredient, notify, onClose }: Props) {
  const { run, pending } = useAsyncAction(notify);
  const [name, setName] = useState(ingredient?.name ?? '');
  const [unit, setUnit] = useState<IngredientUnit>(ingredient?.unit ?? 'un');
  const [unitCost, setUnitCost] = useState(ingredient ? String(ingredient.unitCost).replace('.', ',') : '');
  const [errors, setErrors] = useState<{ name?: string; unitCost?: string }>({});

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsedCost = Number(unitCost.replace(',', '.'));
    const nextErrors: typeof errors = {};
    if (!name.trim()) nextErrors.name = 'Informe o nome do insumo.';
    if (!Number.isFinite(parsedCost) || parsedCost <= 0 || parsedCost > MAX_UNIT_COST) nextErrors.unitCost = 'Informe um custo válido.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    // Custo com até 4 casas (ex.: R$ 0,0134/ml), como o servidor guarda.
    const saved = await run(
      () => saveIngredient(establishmentId, { name: name.trim(), unit, unitCost: Math.round(parsedCost * 10_000) / 10_000 }, ingredient?.id),
      ingredient ? `${name.trim()} atualizado — fichas recalculadas` : `${name.trim()} cadastrado`,
    );
    if (saved) onClose();
  }

  return (
    <Modal title={ingredient ? 'Editar insumo' : 'Novo insumo'} onClose={onClose}>
      <form onSubmit={event => void handleSubmit(event)} className="flex flex-col gap-4" noValidate>
        <FormField label="Nome" htmlFor="ingredient-name" error={errors.name}>
          <input id="ingredient-name" value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="Ex: Queijo cheddar" className={PANEL_INPUT_CLASS} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Unidade" htmlFor="ingredient-unit">
            <select id="ingredient-unit" value={unit} onChange={e => setUnit(e.target.value as IngredientUnit)} className={PANEL_INPUT_CLASS}>
              {UNITS.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={`Custo por ${unit} (R$)`} htmlFor="ingredient-cost" error={errors.unitCost}>
            <input id="ingredient-cost" value={unitCost} onChange={e => setUnitCost(e.target.value)} inputMode="decimal" placeholder="0,00" className={PANEL_INPUT_CLASS} />
          </FormField>
        </div>
        <div className="flex gap-3 mt-1">
          <button type="button" onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">
            Cancelar
          </button>
          <button type="submit" disabled={pending} className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60">
            {ingredient ? 'Salvar' : 'Cadastrar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
