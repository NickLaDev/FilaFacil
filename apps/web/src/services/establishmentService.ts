import { useMemo } from 'react';
import { createPersistentStore, useStore } from '@/lib/store';
import { createId } from '@/lib/utils';
import { DEFAULT_ESTABLISHMENT_IMAGE, ESTABLISHMENTS, ORGANIZATIONS } from '@/data/establishments';
import type { Establishment, EstablishmentStatus, EstablishmentType } from '@/types/establishment';

const establishmentsStore = createPersistentStore('establishments', ESTABLISHMENTS);

export const useEstablishments = () => useStore(establishmentsStore);

export const getEstablishment = (id: string) => establishmentsStore.get().find(e => e.id === id) ?? null;

export function useEstablishment(id: string | null | undefined) {
  const establishments = useEstablishments();
  return establishments.find(e => e.id === id) ?? null;
}

/** Estabelecimento inativo ou suspenso some das buscas do cliente (ficha 34). */
export const isPubliclyVisible = (establishment: Establishment) => establishment.status === 'active';

export function usePublicEstablishments() {
  const establishments = useEstablishments();
  return useMemo(() => establishments.filter(isPubliclyVisible), [establishments]);
}

export const canAcceptOrders = (establishment: Establishment) =>
  isPubliclyVisible(establishment) && (establishment.orderingStatus === 'open' || establishment.orderingStatus === 'busy');

/** Unidades de uma mesma organização (seletor de unidade do gestor, duplicação de layout). */
export function useOrganizationUnits(organizationId: string) {
  const establishments = useEstablishments();
  return useMemo(() => establishments.filter(e => e.organizationId === organizationId), [establishments, organizationId]);
}

export const getOrganizationName = (organizationId: string) =>
  ORGANIZATIONS.find(o => o.id === organizationId)?.name ?? '—';

export interface EstablishmentInput {
  name: string;
  city: string;
  address: string;
  type: EstablishmentType;
  organizationId: string;
  planId: string;
  status: EstablishmentStatus;
}

function createEstablishment(input: EstablishmentInput): Establishment {
  return {
    ...input,
    id: createId('est'),
    createdAt: new Date().toISOString().slice(0, 10),
    foodCategories: input.type === 'Bar' ? ['Bar'] : [],
    hours: 'Horário a definir',
    rating: 0,
    ratingCount: 0,
    avgTime: '15–20 min',
    avgWaitMin: 15,
    distanceM: 1000,
    orderingStatus: 'open',
    highDemand: false,
    images: [DEFAULT_ESTABLISHMENT_IMAGE],
    tags: [],
    mapPosition: { x: 50, y: 50 },
  };
}

export function saveEstablishment(input: EstablishmentInput, id?: string) {
  establishmentsStore.set(prev =>
    id ? prev.map(e => (e.id === id ? { ...e, ...input } : e)) : [...prev, createEstablishment(input)],
  );
}

export function setEstablishmentStatus(id: string, status: EstablishmentStatus) {
  establishmentsStore.set(prev => prev.map(e => (e.id === id ? { ...e, status } : e)));
}

export function setEstablishmentPlan(id: string, planId: string) {
  establishmentsStore.set(prev => prev.map(e => (e.id === id ? { ...e, planId } : e)));
}
