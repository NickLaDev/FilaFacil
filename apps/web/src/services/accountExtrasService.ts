/**
 * Funcionalidades da conta que pertencem à Sprint 2 e ainda não têm backend:
 * favoritos (45), verificação de contato por código (65), recuperação de senha (44),
 * biometria (59) e exclusão LGPD (53). Ficam isoladas aqui, no navegador, até a API existir.
 */
import { useMemo } from 'react';
import type { AuthUser } from '@filafacil/shared';
import { createPersistentStore, useStore } from '@/lib/store';
import { logout } from './authService';

const MOCK_LATENCY_MS = 700;
const wait = (ms = MOCK_LATENCY_MS) => new Promise(resolve => setTimeout(resolve, ms));

/** Código aceito pelos fluxos simulados da Sprint 2 (não vale para o login, que usa OTP real). */
export const SPRINT2_MOCK_CODE = '123456';
/** Validade do código de recuperação de senha (ficha 44). */
export const RECOVERY_CODE_TTL_MS = 30 * 60 * 1000;
/** Intervalo mínimo para reenviar um código (igual ao do servidor). */
export const RESEND_COOLDOWN_SECONDS = 42;

// ─── Favoritos (ficha 45) ───────────────────────────────────────────────────

const favoritesStore = createPersistentStore<Record<string, string[]>>('favorites-by-user', {});

export function useFavoriteIds(userId: string | null) {
  const all = useStore(favoritesStore);
  return useMemo(() => new Set(userId ? (all[userId] ?? []) : []), [all, userId]);
}

export function toggleFavorite(userId: string, establishmentId: string) {
  favoritesStore.set(prev => {
    const current = prev[userId] ?? [];
    const next = current.includes(establishmentId) ? current.filter(id => id !== establishmentId) : [...current, establishmentId];
    return { ...prev, [userId]: next };
  });
}

// ─── Verificação de e-mail/telefone (ficha 65) ──────────────────────────────

/** Contato confirmado pelo fluxo simulado, guardado com o valor confirmado (trocar o contato invalida). */
const verificationsStore = createPersistentStore<Record<string, { email?: string; phone?: string }>>('contact-verifications', {});

export function useVerifiedContacts(user: AuthUser | null) {
  const all = useStore(verificationsStore);
  const local = user ? all[user.id] : undefined;
  return {
    emailVerified: Boolean(user?.emailVerified || (user?.email && local?.email === user.email)),
    phoneVerified: Boolean(user?.phoneVerified || (user?.phone && local?.phone === user.phone)),
  };
}

export function markContactVerified(user: AuthUser, channel: 'email' | 'phone') {
  const value = channel === 'email' ? user.email : user.phone;
  if (!value) return;
  verificationsStore.set(prev => ({ ...prev, [user.id]: { ...prev[user.id], [channel]: value } }));
}

export async function verifyMockCode(code: string) {
  await wait(900);
  return code === SPRINT2_MOCK_CODE;
}

// ─── Recuperação de senha (ficha 44) ────────────────────────────────────────

/** Resposta sempre genérica: não revela se o contato tem conta. */
export async function requestPasswordRecovery() {
  await wait();
  return true;
}

export async function resetPassword() {
  await wait();
}

// ─── Biometria (ficha 59) ───────────────────────────────────────────────────

const deviceStore = createPersistentStore<{ biometricUserId: string | null }>('client-device-v2', { biometricUserId: null });

export const useDevice = () => useStore(deviceStore);

export function setBiometricEnabled(userId: string, enabled: boolean) {
  deviceStore.set({ biometricUserId: enabled ? userId : null });
}

// ─── Exclusão de conta (ficha 53) ───────────────────────────────────────────

/** Simulada: a anonimização é do backend da Sprint 2. Aqui a sessão é encerrada no servidor. */
export async function requestAccountDeletion() {
  await wait();
  deviceStore.set({ biometricUserId: null });
  await logout();
}
