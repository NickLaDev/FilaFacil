import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AdminEstablishmentDto, AdminEstablishmentsPage, EstablishmentStatus, EstablishmentType, OrganizationDto } from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';

/** Administração de estabelecimentos (ficha 34). O cliente usa restaurantService. */
const establishmentsKey = ['admin', 'establishments'] as const;
const organizationsKey = ['admin', 'organizations'] as const;

export interface EstablishmentQuery {
  q: string;
  status: EstablishmentStatus | 'all';
  page: number;
  pageSize: number;
}

export function useAdminEstablishments(query: EstablishmentQuery) {
  return useQuery({
    queryKey: [...establishmentsKey, query],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      api.get<AdminEstablishmentsPage>(
        '/admin/establishments',
        { q: query.q, status: query.status === 'all' ? undefined : query.status, page: query.page, pageSize: query.pageSize },
        signal,
      ),
  });
}

/** Lista completa (para seletores, ex.: vínculo de usuários e uso dos planos). */
export function useAllEstablishments() {
  return useQuery({
    queryKey: [...establishmentsKey, 'all'],
    queryFn: async ({ signal }) => (await api.get<AdminEstablishmentsPage>('/admin/establishments', { pageSize: 100 }, signal)).items,
  });
}

export function useOrganizations() {
  return useQuery({ queryKey: organizationsKey, queryFn: ({ signal }) => api.get<OrganizationDto[]>('/admin/organizations', undefined, signal) });
}

export interface EstablishmentInput {
  name: string;
  type: EstablishmentType;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  organizationId: string;
  planId: string;
  status: EstablishmentStatus;
  averageWaitMinutes: number;
  pickupPoint: string;
  foodCategories: string[];
  openingHours: { weekday: number; opensAt: string; closesAt: string }[];
}

function refresh() {
  void queryClient.invalidateQueries({ queryKey: establishmentsKey });
  void queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
  void queryClient.invalidateQueries({ queryKey: ['restaurants'] });
}

export async function saveEstablishment(input: EstablishmentInput, id?: string) {
  try {
    return id ? await api.patch<AdminEstablishmentDto>(`/admin/establishments/${id}`, input) : await api.post<AdminEstablishmentDto>('/admin/establishments', input);
  } finally {
    refresh();
  }
}

/** Inativo/suspenso some da busca do cliente imediatamente (o servidor filtra e avisa por WebSocket). */
export async function setEstablishmentStatus(id: string, status: EstablishmentStatus) {
  try {
    return await api.patch<AdminEstablishmentDto>(`/admin/establishments/${id}/status`, { status });
  } finally {
    refresh();
  }
}

export async function setEstablishmentPlan(id: string, planId: string) {
  try {
    return await api.put<AdminEstablishmentDto>(`/admin/establishments/${id}/plan`, { planId });
  } finally {
    refresh();
  }
}

export async function addEstablishmentPhoto(id: string, file: File) {
  try {
    return await api.upload<AdminEstablishmentDto>(`/admin/establishments/${id}/photos`, file, 'POST');
  } finally {
    refresh();
  }
}

export async function removeEstablishmentPhoto(id: string, photoId: string) {
  try {
    return await api.delete<AdminEstablishmentDto>(`/admin/establishments/${id}/photos/${photoId}`);
  } finally {
    refresh();
  }
}

export async function createOrganization(name: string) {
  try {
    return await api.post<OrganizationDto>('/admin/organizations', { name });
  } finally {
    void queryClient.invalidateQueries({ queryKey: organizationsKey });
  }
}
