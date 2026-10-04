import { useQuery } from '@tanstack/react-query';
import type { AddressDto, MeResponse } from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { meQueryKey } from './authService';

const addressesKey = ['me', 'addresses'] as const;
const refreshAddresses = () => queryClient.invalidateQueries({ queryKey: addressesKey });

/** Ficha 13: o perfil salvo no servidor vale na hora para as próximas consultas. */
export async function updateProfile(changes: { name: string; email: string; phone: string }) {
  const me = await api.patch<MeResponse>('/me', changes);
  queryClient.setQueryData(meQueryKey, me);
  return me;
}

export function useAddresses(enabled: boolean) {
  return useQuery({ queryKey: addressesKey, queryFn: () => api.get<AddressDto[]>('/me/addresses'), enabled });
}

export type AddressInput = Pick<AddressDto, 'label' | 'street' | 'city'>;

export const saveAddress = (input: AddressInput) => api.post<AddressDto>('/me/addresses', input).finally(refreshAddresses);

export const setDefaultAddress = (addressId: string) =>
  api.patch<AddressDto>(`/me/addresses/${addressId}`, { isDefault: true }).finally(refreshAddresses);

export const deleteAddress = (addressId: string) => api.delete(`/me/addresses/${addressId}`).finally(refreshAddresses);
