import { useState } from 'react';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { cn } from '@/lib/utils';
import { useMenuItems } from '@/services/menuService';
import { useIngredients, useTechnicalSheets } from '@/services/recipeService';
import type { ManagerSectionProps } from '../../types';
import IngredientsTab from './IngredientsTab';
import RecipesTab from './RecipesTab';

type RecipesTabId = 'recipes' | 'ingredients';

/** Ficha 31: custo dos pratos calculado pelo servidor a partir do preço atual de cada insumo. */
export default function RecipesSection({ unit, notify }: ManagerSectionProps) {
  const [tab, setTab] = useState<RecipesTabId>('recipes');
  const items = useMenuItems(unit.id);
  const ingredients = useIngredients(unit.id);
  const sheets = useTechnicalSheets(unit.id);

  const failed = items.error ?? ingredients.error ?? sheets.error;
  if (failed) return <ErrorBlock error={failed} onRetry={() => void Promise.all([items.refetch(), ingredients.refetch(), sheets.refetch()])} />;
  if (!items.data || !ingredients.data || !sheets.data) return <LoadingBlock />;

  return (
    <div className="p-6 flex flex-col gap-5">
      <div className="flex gap-2 border-b border-border">
        {(
          [
            { id: 'recipes', label: `Fichas (${sheets.data.length})` },
            { id: 'ingredients', label: `Insumos (${ingredients.data.length})` },
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
        <RecipesTab establishmentId={unit.id} items={items.data} sheets={sheets.data} ingredients={ingredients.data} notify={notify} />
      ) : (
        <IngredientsTab establishmentId={unit.id} ingredients={ingredients.data} notify={notify} />
      )}
    </div>
  );
}
