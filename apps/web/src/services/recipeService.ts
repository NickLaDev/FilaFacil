import { useQuery } from '@tanstack/react-query';
import type { IngredientDto, IngredientUnit, TechnicalSheetDto } from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { staffKeys } from './staffKeys';

export interface IngredientView {
  id: string;
  name: string;
  unit: IngredientUnit;
  unitCost: number;
  usedInSheets: number;
}

const toIngredient = (ingredient: IngredientDto): IngredientView => ({ ...ingredient, unitCost: Number(ingredient.unitCost) });

const base = (establishmentId: string) => `/establishments/${establishmentId}`;

function refresh(establishmentId: string) {
  void queryClient.invalidateQueries({ queryKey: staffKeys.ingredients(establishmentId) });
  void queryClient.invalidateQueries({ queryKey: staffKeys.sheets(establishmentId) });
}

export function useIngredients(establishmentId: string) {
  return useQuery({
    queryKey: staffKeys.ingredients(establishmentId),
    queryFn: async ({ signal }) => (await api.get<IngredientDto[]>(`${base(establishmentId)}/ingredients`, undefined, signal)).map(toIngredient),
  });
}

/** Ficha 31: custo total, % do preço e alerta de limite calculados pelo servidor. */
export function useTechnicalSheets(establishmentId: string) {
  return useQuery({
    queryKey: staffKeys.sheets(establishmentId),
    queryFn: ({ signal }) => api.get<TechnicalSheetDto[]>(`${base(establishmentId)}/technical-sheets`, undefined, signal),
  });
}

export type IngredientInput = Pick<IngredientView, 'name' | 'unit' | 'unitCost'>;

export async function saveIngredient(establishmentId: string, input: IngredientInput, id?: string) {
  const url = `${base(establishmentId)}/ingredients`;
  try {
    return id ? await api.patch<IngredientDto>(`${url}/${id}`, input) : await api.post<IngredientDto>(url, input);
  } finally {
    refresh(establishmentId);
  }
}

export async function deleteIngredient(establishmentId: string, id: string) {
  try {
    await api.delete(`${base(establishmentId)}/ingredients/${id}`);
  } finally {
    refresh(establishmentId);
  }
}

export interface RecipeLineInput {
  ingredientId: string;
  quantity: number;
}

/** Uma ficha por item: cria ou substitui. O custo enviado nunca vem do navegador. */
export async function saveTechnicalSheet(establishmentId: string, menuItemId: string, lines: RecipeLineInput[], costLimitPercent: number) {
  try {
    return await api.put<TechnicalSheetDto>(`${base(establishmentId)}/technical-sheets/${menuItemId}`, { lines, costLimitPercent });
  } finally {
    refresh(establishmentId);
  }
}

export async function deleteTechnicalSheet(establishmentId: string, menuItemId: string) {
  try {
    await api.delete(`${base(establishmentId)}/technical-sheets/${menuItemId}`);
  } finally {
    refresh(establishmentId);
  }
}

/** Prévia enquanto a ficha é editada; ao salvar, vale o custo calculado pelo servidor. */
export function previewRecipeCost(lines: RecipeLineInput[], ingredients: IngredientView[]) {
  const costById = new Map(ingredients.map(i => [i.id, i.unitCost]));
  return lines.reduce((total, line) => total + (costById.get(line.ingredientId) ?? 0) * line.quantity, 0);
}

export const costPercentOfPrice = (cost: number, price: number) => (price > 0 ? (cost / price) * 100 : 0);
