import { useState } from 'react';
import { AlertTriangle, Edit3, FileText, Plus, Trash2, X } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { cn, formatCurrency } from '@/lib/utils';
import { calculateRecipeCost, costPercentOfPrice, deleteRecipe } from '@/services/recipeService';
import type { Ingredient, MenuItem, Recipe } from '@/types/catalog';
import ConfirmDialog from '../../components/ConfirmDialog';
import RecipeEditorModal from './RecipeEditorModal';
import { formatPercent, formatQuantity } from './recipeFormat';

const ALL_CATEGORIES = 'all';

interface Props {
  items: MenuItem[];
  recipes: Recipe[];
  ingredients: Ingredient[];
  notify: (message: string) => void;
}

export default function RecipesTab({ items, recipes, ingredients, notify }: Props) {
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Recipe | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Recipe | null>(null);

  const rows = recipes.flatMap(recipe => {
    const item = items.find(i => i.id === recipe.menuItemId);
    if (!item) return [];
    const cost = calculateRecipeCost(recipe, ingredients);
    const percent = costPercentOfPrice(cost, item.price);
    return [{ recipe, item, cost, percent, overLimit: percent > recipe.costLimitPercent }];
  });
  const categories = [ALL_CATEGORIES, ...new Set(rows.map(r => r.item.category))];
  const filtered = category === ALL_CATEGORIES ? rows : rows.filter(r => r.item.category === category);
  const overLimit = rows.filter(r => r.overLimit);
  const selected = rows.find(r => r.recipe.id === selectedId) ?? null;
  const itemsWithoutRecipe = items.filter(i => !recipes.some(r => r.menuItemId === i.id));
  const ingredientById = new Map(ingredients.map(i => [i.id, i]));

  return (
    <div className="flex flex-col gap-4">
      {overLimit.length > 0 && (
        <div className="bg-warning-bg border border-warning/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={15} className="text-warning" />
            <p className="font-display font-semibold text-warning text-sm">Custo acima do limite — {overLimit.length} prato(s)</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {overLimit.map(row => (
              <span key={row.recipe.id} className="text-xs bg-warning/10 text-warning font-medium px-2.5 py-1 rounded-full">
                {row.item.name} ({formatPercent(row.percent)} · limite {row.recipe.costLimitPercent}%)
              </span>
            ))}
          </div>
          <p className="text-xs text-warning/80 mt-3">Revise o preço de venda ou as quantidades da ficha.</p>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {categories.map(option => (
          <button
            key={option}
            onClick={() => setCategory(option)}
            className={cn('px-3 py-1.5 rounded-full text-sm font-medium transition-colors', category === option ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:text-foreground')}
          >
            {option === ALL_CATEGORIES ? 'Todas' : option}
          </button>
        ))}
        <button
          onClick={() => setEditing('new')}
          disabled={itemsWithoutRecipe.length === 0 || ingredients.length === 0}
          title={ingredients.length === 0 ? 'Cadastre insumos primeiro' : itemsWithoutRecipe.length === 0 ? 'Todos os itens já têm ficha' : undefined}
          className="ml-auto flex items-center gap-2 bg-primary text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          <Plus size={13} />
          Nova ficha
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="bg-card border border-border rounded-xl">
          <EmptyState icon={FileText} title="Nenhuma ficha técnica" description="Vincule insumos e quantidades a um item do cardápio para acompanhar o custo do prato." />
        </div>
      ) : (
        <div className="flex flex-col xl:flex-row gap-6 items-start">
          <div className="flex-1 w-full bg-card border border-border rounded-xl overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Produto', 'Categoria', 'Ingredientes', 'Custo', 'Preço venda', 'Custo %', 'Margem'].map(header => (
                    <th key={header} className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => (
                  <tr
                    key={row.recipe.id}
                    onClick={() => setSelectedId(row.recipe.id === selectedId ? null : row.recipe.id)}
                    className={cn('border-b border-border last:border-0 cursor-pointer transition-colors', row.recipe.id === selectedId ? 'bg-primary/5' : 'hover:bg-muted/10')}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{row.item.name}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{row.item.category}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{row.recipe.lines.length}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{formatCurrency(row.cost)}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{formatCurrency(row.item.price)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={cn('text-sm font-bold', row.overLimit ? 'text-warning' : 'text-foreground')}>{formatPercent(row.percent)}</span>
                        {row.overLimit && <span className="text-[10px] font-bold bg-warning-bg text-warning px-2 py-0.5 rounded-full whitespace-nowrap">Acima do limite</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('text-sm font-bold', row.overLimit ? 'text-warning' : 'text-success')}>{formatPercent(100 - row.percent)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="w-full xl:w-72 bg-card border border-border rounded-xl p-5 flex-shrink-0">
              <div className="flex items-center justify-between mb-4">
                <p className="font-display font-bold text-foreground">{selected.item.name}</p>
                <button onClick={() => setSelectedId(null)} aria-label="Fechar ficha">
                  <X size={14} className="text-muted-foreground" />
                </button>
              </div>
              <div className="flex flex-col gap-2 mb-4">
                {selected.recipe.lines.map(line => {
                  const ingredient = ingredientById.get(line.ingredientId);
                  if (!ingredient) return null;
                  return (
                    <div key={line.ingredientId} className="flex items-center justify-between text-sm py-2 border-b border-border last:border-0">
                      <span className="text-foreground">{ingredient.name}</span>
                      <div className="text-right">
                        <p className="text-muted-foreground text-xs">{formatQuantity(line.quantity)} {ingredient.unit}</p>
                        <p className="text-foreground font-medium">{formatCurrency(ingredient.unitCost * line.quantity)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="bg-muted rounded-lg p-3 flex flex-col gap-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Custo total</span>
                  <span className="font-medium text-foreground">{formatCurrency(selected.cost)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Preço venda</span>
                  <span className="font-medium text-foreground">{formatCurrency(selected.item.price)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Limite de custo</span>
                  <span className="font-medium text-foreground">{selected.recipe.costLimitPercent}%</span>
                </div>
                <div className="flex justify-between text-sm pt-1.5 border-t border-border mt-0.5">
                  <span className="font-semibold text-foreground">Margem</span>
                  <span className={cn('font-bold', selected.overLimit ? 'text-warning' : 'text-success')}>{formatPercent(100 - selected.percent)}</span>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => setEditing(selected.recipe)} className="flex-1 flex items-center justify-center gap-2 bg-primary text-white py-2 rounded-lg text-sm font-medium hover:bg-primary/90">
                  <Edit3 size={13} />
                  Editar ficha
                </button>
                <button onClick={() => setDeleting(selected.recipe)} aria-label="Excluir ficha" className="px-3 bg-error/10 text-error rounded-lg hover:bg-error/20">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {editing && (
        <RecipeEditorModal
          recipe={editing === 'new' ? undefined : editing}
          items={editing === 'new' ? itemsWithoutRecipe : items}
          ingredients={ingredients}
          onClose={() => setEditing(null)}
          onSaved={notify}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Excluir ficha técnica"
          message="O item continua no cardápio; só a ficha de custo é removida."
          confirmLabel="Excluir ficha"
          onConfirm={() => {
            deleteRecipe(deleting.id);
            setSelectedId(null);
            notify('Ficha técnica excluída');
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
