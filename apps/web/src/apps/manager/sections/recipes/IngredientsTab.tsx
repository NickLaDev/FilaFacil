import { useState } from 'react';
import { Edit3, Package, Plus, Trash2 } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { deleteIngredient } from '@/services/recipeService';
import type { Ingredient, Recipe } from '@/types/catalog';
import ConfirmDialog from '../../components/ConfirmDialog';
import IngredientFormModal from './IngredientFormModal';
import { formatUnitCost } from './recipeFormat';

interface Props {
  establishmentId: string;
  ingredients: Ingredient[];
  recipes: Recipe[];
  notify: (message: string) => void;
}

export default function IngredientsTab({ establishmentId, ingredients, recipes, notify }: Props) {
  const [editing, setEditing] = useState<Ingredient | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Ingredient | null>(null);

  const usageCount = (ingredientId: string) => recipes.filter(r => r.lines.some(line => line.ingredientId === ingredientId)).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">Alterar o custo de um insumo recalcula todas as fichas que o usam.</p>
        <button onClick={() => setEditing('new')} className="flex items-center gap-2 bg-primary text-white px-3 py-1.5 rounded-lg text-sm font-medium">
          <Plus size={13} />
          Novo insumo
        </button>
      </div>

      {ingredients.length === 0 ? (
        <div className="bg-card border border-border rounded-xl">
          <EmptyState icon={Package} title="Nenhum insumo cadastrado" description="Cadastre ingredientes com unidade e custo para montar as fichas técnicas." />
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['Insumo', 'Unidade', 'Custo unitário', 'Usado em', 'Ações'].map(header => (
                  <th key={header} className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ingredients.map(ingredient => {
                const usage = usageCount(ingredient.id);
                return (
                  <tr key={ingredient.id} className="border-b border-border last:border-0 hover:bg-muted/10">
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{ingredient.name}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{ingredient.unit}</td>
                    <td className="px-4 py-3 text-sm text-foreground">
                      {formatUnitCost(ingredient.unitCost)} <span className="text-muted-foreground">/ {ingredient.unit}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{usage === 0 ? '—' : `${usage} ficha${usage > 1 ? 's' : ''}`}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => setEditing(ingredient)} aria-label={`Editar ${ingredient.name}`} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground">
                          <Edit3 size={14} />
                        </button>
                        <button onClick={() => setDeleting(ingredient)} aria-label={`Excluir ${ingredient.name}`} className="p-1.5 hover:bg-error-bg rounded-lg text-muted-foreground hover:text-error">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <IngredientFormModal
          establishmentId={establishmentId}
          ingredient={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={notify}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Excluir insumo"
          message={
            usageCount(deleting.id) > 0
              ? `"${deleting.name}" será removido das ${usageCount(deleting.id)} ficha(s) que o usam, e o custo delas será recalculado.`
              : `"${deleting.name}" será removido da lista de insumos.`
          }
          confirmLabel="Excluir insumo"
          onConfirm={() => {
            deleteIngredient(deleting.id);
            notify(`${deleting.name} excluído`);
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
