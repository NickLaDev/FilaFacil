import { useQuery } from '@tanstack/react-query';
import type { AuthProvidersResponse, MeResponse, OtpChallengeResponse, OtpChannel } from '@filafacil/shared';
import { api, API_BASE_URL, isApiError } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { reconnectRealtime } from '@/lib/realtime';

export const meQueryKey = ['me'] as const;

/** Sessão atual: os cookies HttpOnly ficam com o navegador; aqui só os dados da conta. */
async function fetchMe(): Promise<MeResponse | null> {
  try {
    return await api.get<MeResponse>('/me');
  } catch (error) {
    if (isApiError(error) && error.status === 401) return null;
    throw error;
  }
}

/** Conta logada (null = visitante). A sessão persiste ao fechar e reabrir o navegador (ficha 06). */
export function useMe() {
  return useQuery({ queryKey: meQueryKey, queryFn: fetchMe, staleTime: 60_000 });
}

function startSession(me: MeResponse) {
  queryClient.setQueryData(meQueryKey, me);
  reconnectRealtime();
  return me;
}

const PUBLIC_QUERY_ROOTS = new Set(['restaurants', 'auth']);

/**
 * Limpa os dados privados em cache (os públicos, como restaurantes, continuam). A consulta
 * da conta não é removida — só passa a valer `null` —, para não interromper quem a observa.
 */
export function endSession() {
  queryClient.removeQueries({
    predicate: ({ queryKey }) => !PUBLIC_QUERY_ROOTS.has(String(queryKey[0])) && !(queryKey.length === 1 && queryKey[0] === meQueryKey[0]),
  });
  queryClient.setQueryData(meQueryKey, null);
  reconnectRealtime();
}

/** Sessão vencida/revogada: só limpa se havia alguém logado (evita laço no carregamento inicial). */
export function handleSessionExpired() {
  if (queryClient.getQueryData(meQueryKey)) endSession();
}

export const loginWithEmail = (email: string, password: string) =>
  api.post<MeResponse>('/auth/login', { email: email.trim(), password }).then(startSession);

export const requestLoginCode = (channel: OtpChannel, destination: string) =>
  api.post<OtpChallengeResponse>('/auth/otp', { channel, destination: destination.trim() });

export const verifyLoginCode = (challengeId: string, code: string) =>
  api.post<MeResponse>('/auth/otp/verify', { challengeId, code }).then(startSession);

export interface SignupInput {
  name: string;
  cpf: string;
  email?: string;
  password?: string;
  phone?: string;
  marketingOptIn: boolean;
}

/** Ficha 01: o servidor valida o CPF, impede duplicidade e já abre a sessão. */
export const registerAccount = (input: SignupInput) =>
  api.post<MeResponse>('/auth/register', { ...input, acceptTerms: true }).then(startSession);

export async function logout() {
  try {
    await api.post('/auth/logout');
  } finally {
    endSession();
  }
}

export function useAuthProviders() {
  return useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: () => api.get<AuthProvidersResponse>('/auth/providers'),
    staleTime: Infinity,
  });
}

/** Login social: o navegador vai ao provedor e volta para o app com ?auth=success ou ?auth_error=… */
export function startProviderLogin(provider: 'google' | 'apple') {
  window.location.assign(`${API_BASE_URL}/auth/oauth/${provider}`);
}

export const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_cancelled: 'Login cancelado.',
  oauth_state_invalid: 'O login expirou. Tente novamente.',
  account_suspended: 'Sua conta está suspensa.',
  provider_not_configured: 'Este login ainda não está disponível.',
};
