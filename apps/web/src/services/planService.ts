import { useQuery, useQueryClient } from '@tanstack/react-query';
import { REALTIME_EVENTS, UNLIMITED, type EstablishmentPlanDto, type PlanDto, type PlanFeature } from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { useRealtime } from '@/lib/realtime';
import { staffKeys } from './staffKeys';

export const formatPlanLimit = (value: number) => (value >= UNLIMITED ? 'Ilimitado' : String(value));

/**
 * Plano vigente do estabelecimento. Quando o admin troca o plano, o servidor avisa a equipe e o
 * painel recarrega — a API já bloqueia/libera os recursos por conta própria (ficha 37).
 */
export function useEstablishmentPlan(establishmentId: string) {
  const client = useQueryClient();
  useRealtime(establishmentId ? { establishmentId } : null, [REALTIME_EVENTS.establishmentUpdated], () => {
    void client.invalidateQueries({ queryKey: staffKeys.root(establishmentId) });
    void client.invalidateQueries({ queryKey: ['me'] });
  });
  return useQuery({
    queryKey: staffKeys.plan(establishmentId),
    enabled: Boolean(establishmentId),
    queryFn: ({ signal }) => api.get<EstablishmentPlanDto>(`/establishments/${establishmentId}/plan`, undefined, signal),
  });
}

export function useHasPlanFeature(establishmentId: string, feature: PlanFeature) {
  return useEstablishmentPlan(establishmentId).data?.features.includes(feature) ?? false;
}

// ─── Admin ──────────────────────────────────────────────────────────────────

const plansKey = ['admin', 'plans'] as const;

export function usePlans() {
  return useQuery({ queryKey: plansKey, queryFn: ({ signal }) => api.get<PlanDto[]>('/admin/plans', undefined, signal) });
}

export type PlanInput = Pick<PlanDto, 'name' | 'monthlyPriceCents' | 'limits' | 'features'>;

function refreshPlans() {
  void queryClient.invalidateQueries({ queryKey: plansKey });
  void queryClient.invalidateQueries({ queryKey: ['admin', 'establishments'] });
}

export async function savePlan(input: PlanInput, id?: string) {
  try {
    return id ? await api.patch<PlanDto>(`/admin/plans/${id}`, input) : await api.post<PlanDto>('/admin/plans', input);
  } finally {
    refreshPlans();
  }
}

export async function deletePlan(id: string) {
  try {
    await api.delete(`/admin/plans/${id}`);
  } finally {
    refreshPlans();
  }
}
