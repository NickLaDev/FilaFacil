import { createPersistentStore, useStore } from '@/lib/store';
import { createId } from '@/lib/utils';
import { PLANS, UNLIMITED } from '@/data/establishments';
import type { Plan, PlanFeature } from '@/types/establishment';
import { useEstablishment } from './establishmentService';

const plansStore = createPersistentStore('plans', PLANS);

export const usePlans = () => useStore(plansStore);

export const formatPlanLimit = (value: number) => (value >= UNLIMITED ? 'Ilimitado' : String(value));

export type PlanInput = Omit<Plan, 'id'>;

export function savePlan(input: PlanInput, id?: string) {
  plansStore.set(prev => (id ? prev.map(p => (p.id === id ? { ...p, ...input } : p)) : [...prev, { ...input, id: createId('plan') }]));
}

export function deletePlan(id: string) {
  plansStore.set(prev => prev.filter(p => p.id !== id));
}

export function useEstablishmentPlan(establishmentId: string) {
  const establishment = useEstablishment(establishmentId);
  const plans = usePlans();
  return plans.find(p => p.id === establishment?.planId) ?? null;
}

/** Recurso liberado pelo plano contratado — muda na hora em que o admin migra o plano (ficha 37). */
export function useHasPlanFeature(establishmentId: string, feature: PlanFeature) {
  return useEstablishmentPlan(establishmentId)?.features.includes(feature) ?? false;
}
