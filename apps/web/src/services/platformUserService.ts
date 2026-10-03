import { createPersistentStore, useStore } from '@/lib/store';
import { createId } from '@/lib/utils';
import { PERMISSION_HISTORY, PERMISSIONS, PLATFORM_USERS, ROLE_DEFAULT_PERMISSIONS, ROLE_LABELS } from '@/data/users';
import type { PermissionChange, PlatformRole, PlatformUser, PlatformUserStatus } from '@/types/user';

const usersStore = createPersistentStore('platform-users', PLATFORM_USERS);
const historyStore = createPersistentStore('permission-history', PERMISSION_HISTORY);

export const usePlatformUsers = () => useStore(usersStore);
export const usePermissionHistory = () => useStore(historyStore);

const permissionLabel = (id: string) => PERMISSIONS.find(p => p.id === id)?.label ?? id;

function logChange(user: PlatformUser, description: string, actor: string) {
  const change: PermissionChange = {
    id: createId('perm'),
    userId: user.id,
    userName: user.name,
    description,
    actor,
    at: new Date().toISOString(),
  };
  historyStore.set(prev => [change, ...prev]);
}

/** Toda alteração de papel/permissão fica registrada no histórico (ficha 36). */
export function updateUserAccess(userId: string, role: PlatformRole, permissions: string[], actor: string) {
  const user = usersStore.get().find(u => u.id === userId);
  if (!user) return;
  const changes: string[] = [];
  if (user.role !== role) changes.push(`Papel alterado de ${ROLE_LABELS[user.role]} para ${ROLE_LABELS[role]}`);
  const added = permissions.filter(p => !user.permissions.includes(p));
  const removed = user.permissions.filter(p => !permissions.includes(p));
  if (added.length) changes.push(`Permissões concedidas: ${added.map(permissionLabel).join(', ')}`);
  if (removed.length) changes.push(`Permissões removidas: ${removed.map(permissionLabel).join(', ')}`);
  if (!changes.length) return;
  usersStore.set(prev => prev.map(u => (u.id === userId ? { ...u, role, permissions } : u)));
  changes.forEach(description => logChange(user, description, actor));
}

export function setUserStatus(userId: string, status: PlatformUserStatus, actor: string) {
  const user = usersStore.get().find(u => u.id === userId);
  if (!user || user.status === status) return;
  usersStore.set(prev => prev.map(u => (u.id === userId ? { ...u, status } : u)));
  logChange(user, status === 'suspended' ? 'Usuário suspenso' : 'Usuário reativado', actor);
}

export function registerClientUser(name: string, email: string) {
  const user: PlatformUser = {
    id: createId('usr'),
    name,
    email,
    role: 'client',
    permissions: ROLE_DEFAULT_PERMISSIONS.client,
    status: 'active',
    lastAccess: 'Agora',
  };
  usersStore.set(prev => [...prev, user]);
}

export function removeUserByEmail(email: string) {
  usersStore.set(prev => prev.filter(u => u.email !== email));
}

/** Suspensão vale imediatamente para qualquer sessão aberta (ficha 36). */
export function useIsSuspended(lookup: { id?: string; email?: string }) {
  const users = usePlatformUsers();
  const user = users.find(u => (lookup.id ? u.id === lookup.id : u.email === lookup.email));
  return user?.status === 'suspended';
}

export function usePlatformUser(id: string) {
  return usePlatformUsers().find(u => u.id === id) ?? null;
}
