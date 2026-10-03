import { useMemo } from 'react';
import { createPersistentStore, useStore } from '@/lib/store';
import { createId } from '@/lib/utils';
import { INGREDIENTS, RECIPES } from '@/data/catalog';
import type { Ingredient, Recipe, RecipeLine } from '@/types/catalog';

const ingredientsStore = createPersistentStore('ingredients', INGREDIENTS);
const recipesStore = createPersistentStore('recipes', RECIPES);

export function useIngredients(establishmentId: string) {
  const ingredients = useStore(ingredientsStore);
  return useMemo(() => ingredients.filter(i => i.establishmentId === establishmentId), [ingredients, establishmentId]);
}

export const useRecipes = () => useStore(recipesStore);

export type IngredientInput = Omit<Ingredient, 'id' | 'establishmentId'>;

export function saveIngredient(establishmentId: string, input: IngredientInput, id?: string) {
  ingredientsStore.set(prev =>
    id ? prev.map(i => (i.id === id ? { ...i, ...input } : i)) : [...prev, { ...input, id: createId('ing'), establishmentId }],
  );
}

export function deleteIngredient(id: string) {
  ingredientsStore.set(prev => prev.filter(i => i.id !== id));
  recipesStore.set(prev => prev.map(r => ({ ...r, lines: r.lines.filter(line => line.ingredientId !== id) })));
}

/** Uma ficha por item do cardápio: cria ou substitui. */
export function saveRecipe(menuItemId: string, lines: RecipeLine[], costLimitPercent: number) {
  recipesStore.set(prev => {
    const existing = prev.find(r => r.menuItemId === menuItemId);
    if (existing) return prev.map(r => (r.id === existing.id ? { ...r, lines, costLimitPercent } : r));
    return [...prev, { id: createId('recipe'), menuItemId, lines, costLimitPercent }];
  });
}

export function deleteRecipe(id: string) {
  recipesStore.set(prev => prev.filter(r => r.id !== id));
}

/** Custo sempre derivado do preço atual dos insumos: mudar um insumo recalcula todos os pratos (ficha 31). */
export function calculateRecipeCost(recipe: Recipe, ingredients: Ingredient[]) {
  const costById = new Map(ingredients.map(i => [i.id, i.unitCost]));
  return recipe.lines.reduce((total, line) => total + (costById.get(line.ingredientId) ?? 0) * line.quantity, 0);
}

export const costPercentOfPrice = (cost: number, price: number) => (price > 0 ? (cost / price) * 100 : 0);
