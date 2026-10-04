import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AdminUserDto, AdminUsersPage, Page, Permission, PermissionAuditDto, UserRole, UserStatus } from '@filafacil/shared';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';

/** Usuários da plataforma (ficha 36). */
const usersKey = ['admin', 'users'] as const;
const auditKey = ['admin', 'permission-audit'] as const;

export interface UserQuery {
  q: string;
  role: UserRole | 'all';
  page: number;
  pageSize: number;
}

export function usePlatformUsers(query: UserQuery) {
  return useQuery({
    queryKey: [...usersKey, query],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      api.get<AdminUsersPage>('/admin/users', { q: query.q, role: query.role === 'all' ? undefined : query.role, page: query.page, pageSize: query.pageSize }, signal),
  });
}

export function usePermissionHistory(page: number, pageSize: number) {
  return useQuery({
    queryKey: [...auditKey, page, pageSize],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.get<Page<PermissionAuditDto>>('/admin/permission-audit', { page, pageSize }, signal),
  });
}

function refresh() {
  void queryClient.invalidateQueries({ queryKey: usersKey });
  void queryClient.invalidateQueries({ queryKey: auditKey });
  void queryClient.invalidateQueries({ queryKey: ['admin', 'establishments'] });
}

/** Toda alteração de papel/permissão/vínculo fica no histórico do servidor. */
export async function updateUserAccess(userId: string, role: UserRole, permissions: Permission[], establishmentIds: string[]) {
  try {
    return await api.patch<AdminUserDto>(`/admin/users/${userId}/access`, { role, permissions, establishmentIds });
  } finally {
    refresh();
  }
}

/** Suspensão derruba as sessões abertas do usuário na hora. */
export async function setUserStatus(userId: string, status: UserStatus) {
  try {
    return await api.patch<AdminUserDto>(`/admin/users/${userId}/status`, { status });
  } finally {
    refresh();
  }
}
