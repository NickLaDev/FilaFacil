import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useMenuItems } from '@/services/menuService';
import { useIngredients, useRecipes } from '@/services/recipeService';
import type { ManagerSectionProps } from '../../types';
import IngredientsTab from './IngredientsTab';
import RecipesTab from './RecipesTab';

type RecipesTabId = 'recipes' | 'ingredients';

/** Ficha 31: custo dos pratos derivado do preço atual de cada insumo. */
export default function RecipesSection({ unit, notify }: ManagerSectionProps) {
  const [tab, setTab] = useState<RecipesTabId>('recipes');
  const items = useMenuItems(unit.id);
  const ingredients = useIngredients(unit.id);
  const allRecipes = useRecipes();
  const recipes = allRecipes.filter(r => items.some(i => i.id === r.menuItemId));

  return (
    <div className="p-6 flex flex-col gap-5">
      <div className="flex gap-2 border-b border-border">
        {(
          [
            { id: 'recipes', label: `Fichas (${recipes.length})` },
            { id: 'ingredients', label: `Insumos (${ingredients.length})` },
          ] as const
        ).map(option => (
          <button
            key={option.id}
            onClick={() => setTab(option.id)}
            className={cn(
              'px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors',
              tab === option.id ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {tab === 'recipes' ? (
        <RecipesTab items={items} recipes={recipes} ingredients={ingredients} notify={notify} />
      ) : (
        <IngredientsTab establishmentId={unit.id} ingredients={ingredients} recipes={recipes} notify={notify} />
      )}
    </div>
  );
}
