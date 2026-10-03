import { useState, type FormEvent } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import { cn, createId, formatCurrency } from '@/lib/utils';
import { calculateRecipeCost, costPercentOfPrice, saveRecipe } from '@/services/recipeService';
import type { Ingredient, MenuItem, Recipe } from '@/types/catalog';
import { formatPercent } from './recipeFormat';

const DEFAULT_COST_LIMIT = 35;

interface DraftLine {
  key: string;
  ingredientId: string;
  quantity: string;
}

interface Props {
  recipe?: Recipe;
  /** Itens selecionáveis: na criação, só os que ainda não têm ficha. */
  items: MenuItem[];
  ingredients: Ingredient[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

const parseQuantity = (value: string) => Number(value.replace(',', '.'));

export default function RecipeEditorModal({ recipe, items, ingredients, onClose, onSaved }: Props) {
  const [menuItemId, setMenuItemId] = useState(recipe?.menuItemId ?? items[0]?.id ?? '');
  const [lines, setLines] = useState<DraftLine[]>(() =>
    recipe?.lines.length
      ? recipe.lines.map(line => ({ key: createId('line'), ingredientId: line.ingredientId, quantity: String(line.quantity).replace('.', ',') }))
      : [{ key: createId('line'), ingredientId: ingredients[0]?.id ?? '', quantity: '' }],
  );
  const [limit, setLimit] = useState(String(recipe?.costLimitPercent ?? DEFAULT_COST_LIMIT));
  const [error, setError] = useState('');

  const item = items.find(i => i.id === menuItemId);
  const validLines = lines
    .map(line => ({ ingredientId: line.ingredientId, quantity: parseQuantity(line.quantity) }))
    .filter(line => line.ingredientId && Number.isFinite(line.quantity) && line.quantity > 0);
  const cost = calculateRecipeCost({ id: '', menuItemId, costLimitPercent: 0, lines: validLines }, ingredients);
  const percent = item ? costPercentOfPrice(cost, item.price) : 0;
  const limitValue = Number(limit);
  const overLimit = item !== undefined && Number.isFinite(limitValue) && percent > limitValue;

  const updateLine = (key: string, patch: Partial<DraftLine>) => setLines(prev => prev.map(line => (line.key === key ? { ...line, ...patch } : line)));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const ingredientIds = lines.map(line => line.ingredientId);
    if (!item) return setError('Escolha o item do cardápio.');
    if (lines.length === 0) return setError('Adicione pelo menos um insumo.');
    if (validLines.length !== lines.length) return setError('Cada linha precisa de um insumo e uma quantidade maior que zero.');
    if (new Set(ingredientIds).size !== ingredientIds.length) return setError('Cada insumo pode aparecer só uma vez na ficha.');
    if (!Number.isFinite(limitValue) || limitValue <= 0 || limitValue > 100) return setError('O limite de custo deve ficar entre 1% e 100%.');
    saveRecipe(item.id, validLines, Math.round(limitValue));
    onSaved(`Ficha técnica de ${item.name} salva`);
    onClose();
  }

  return (
    <Modal title={recipe ? 'Editar ficha técnica' : 'Nova ficha técnica'} onClose={onClose} width="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-3">
          <FormField label="Item do cardápio" htmlFor="recipe-item">
            <select id="recipe-item" value={menuItemId} onChange={e => setMenuItemId(e.target.value)} disabled={Boolean(recipe)} className={PANEL_INPUT_CLASS}>
              {items.map(option => (
                <option key={option.id} value={option.id}>
                  {option.name} · {formatCurrency(option.price)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Limite de custo (%)" htmlFor="recipe-limit">
            <input id="recipe-limit" type="number" min={1} max={100} value={limit} onChange={e => setLimit(e.target.value)} className={PANEL_INPUT_CLASS} />
          </FormField>
        </div>

        <div>
          <p className="text-xs text-muted-foreground font-medium mb-1.5">Insumos e quantidades</p>
          <div className="flex flex-col gap-2">
            {lines.map(line => {
              const ingredient = ingredients.find(i => i.id === line.ingredientId);
              const quantity = parseQuantity(line.quantity);
              return (
                <div key={line.key} className="flex items-center gap-2">
                  <select
                    value={line.ingredientId}
                    onChange={e => updateLine(line.key, { ingredientId: e.target.value })}
                    aria-label="Insumo"
                    className={cn(PANEL_INPUT_CLASS, 'flex-1')}
                  >
                    {ingredients.map(option => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <input
                    value={line.quantity}
                    onChange={e => updateLine(line.key, { quantity: e.target.value })}
                    inputMode="decimal"
                    placeholder="Qtd."
                    aria-label="Quantidade"
                    className={cn(PANEL_INPUT_CLASS, 'w-24')}
                  />
                  <span className="text-xs text-muted-foreground w-6">{ingredient?.unit}</span>
                  <span className="text-xs text-foreground w-20 text-right">
                    {ingredient && Number.isFinite(quantity) && quantity > 0 ? formatCurrency(ingredient.unitCost * quantity) : '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLines(prev => prev.filter(l => l.key !== line.key))}
                    aria-label="Remover insumo"
                    className="p-2 hover:bg-error-bg rounded-lg text-muted-foreground hover:text-error"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setLines(prev => [...prev, { key: createId('line'), ingredientId: ingredients[0]?.id ?? '', quantity: '' }])}
            className="mt-2 flex items-center gap-1.5 text-sm text-primary font-medium"
          >
            <Plus size={14} />
            Adicionar insumo
          </button>
        </div>

        <div className={cn('rounded-lg p-3 flex flex-col gap-1.5', overLimit ? 'bg-warning-bg' : 'bg-muted')}>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Custo calculado</span>
            <span className="font-medium text-foreground">{formatCurrency(cost)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Custo sobre o preço</span>
            <span className={cn('font-bold', overLimit ? 'text-warning' : 'text-foreground')}>{formatPercent(percent)}</span>
          </div>
          {overLimit && (
            <p className="flex items-center gap-1.5 text-xs text-warning font-medium mt-1">
              <AlertTriangle size={12} />
              Custo acima do limite definido para este prato.
            </p>
          )}
        </div>

        {error && <p className="text-error text-xs">{error}</p>}

        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">
            Cancelar
          </button>
          <button type="submit" className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold">
            Salvar ficha
          </button>
        </div>
      </form>
    </Modal>
  );
}
