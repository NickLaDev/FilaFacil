import { useQuery } from '@tanstack/react-query';
import type { PromotionDto } from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { restaurantKeys } from './restaurantService';
import { staffKeys } from './staffKeys';

export type PromotionInput = Pick<PromotionDto, 'name' | 'discountPercent' | 'startsAt' | 'endsAt' | 'itemIds'>;

const base = (establishmentId: string) => `/establishments/${establishmentId}/promotions`;

function refresh(establishmentId: string) {
  void queryClient.invalidateQueries({ queryKey: staffKeys.promotions(establishmentId) });
  void queryClient.invalidateQueries({ queryKey: restaurantKeys.menu(establishmentId) });
}

/** Ficha 29: o status (agendada/ativa/encerrada) vem do servidor, derivado do período. */
export function usePromotions(establishmentId: string) {
  return useQuery({ queryKey: staffKeys.promotions(establishmentId), queryFn: ({ signal }) => api.get<PromotionDto[]>(base(establishmentId), undefined, signal) });
}

export async function savePromotion(establishmentId: string, input: PromotionInput, id?: string) {
  try {
    return id ? await api.patch<PromotionDto>(`${base(establishmentId)}/${id}`, input) : await api.post<PromotionDto>(base(establishmentId), input);
  } finally {
    refresh(establishmentId);
  }
}

export async function deletePromotion(establishmentId: string, id: string) {
  try {
    await api.delete(`${base(establishmentId)}/${id}`);
  } finally {
    refresh(establishmentId);
  }
}

/** Prévia do preço com desconto no formulário (o preço vigente oficial é calculado pelo servidor). */
export const applyDiscount = (price: number, discountPercent: number) => Math.round(price * (100 - discountPercent)) / 100;
