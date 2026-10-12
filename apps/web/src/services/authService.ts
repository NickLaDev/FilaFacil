import { useQuery } from '@tanstack/react-query';
import { startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser';
import type { AuthProvidersResponse, MeResponse, OtpChallengeResponse, OtpChannel, PasskeyDto, WebAuthnOptionsDto } from '@filafacil/shared';
import { api, API_BASE_URL, isApiError } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { reconnectRealtime, setRealtimeRecovery } from '@/lib/realtime';
import { setBiometricHint } from './deviceService';

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

// Socket conectado sem sessão (cookie de acesso venceu antes de reconectar): uma chamada autenticada renova o
// cookie pelo refresh do cliente HTTP e só então a conexão refaz o handshake já autenticada.
setRealtimeRecovery(() => {
  if (!queryClient.getQueryData(meQueryKey)) return;
  void api
    .get('/me')
    .then(reconnectRealtime)
    .catch(() => undefined);
});

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

/** Ficha 65: o servidor envia o código ao contato da conta e só ele pode confirmá-lo. */
export const requestContactCode = (channel: OtpChannel) => api.post<OtpChallengeResponse>('/auth/verify-contact', { channel });

export const confirmContactCode = (challengeId: string, code: string) =>
  api.post<MeResponse>('/auth/verify-contact/confirm', { challengeId, code }).then(me => queryClient.setQueryData(meQueryKey, me));

export const verifyLoginCode = (challengeId: string, code: string) =>
  api.post<MeResponse>('/auth/otp/verify', { challengeId, code }).then(startSession);

/** Ficha 44: resposta sempre genérica (não revela se o contato tem conta); o código vale 10 minutos. */
export const requestPasswordReset = (channel: OtpChannel, destination: string) =>
  api.post<OtpChallengeResponse>('/auth/password-reset', { channel, destination: destination.trim() });

/** Confere o código e grava a nova senha no mesmo passo; depois o login já funciona com ela. */
export const resetPassword = (challengeId: string, code: string, newPassword: string) =>
  api.post<void>('/auth/password-reset/confirm', { challengeId, code, newPassword });

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

/** Ficha 53: contas sem senha (login social/OTP) recebem um código no contato verificado. */
/** Conta sem senha: código para confirmar a ativação da biometria (vai ao contato já verificado). */
export const requestBiometricCode = (channel: OtpChannel) => api.post<OtpChallengeResponse>('/auth/webauthn/register/code', { channel });

export const requestAccountDeletionCode = (channel: OtpChannel) => api.post<OtpChallengeResponse>('/me/delete-account/code', { channel });

/** Reautentica com a senha ou com o código; o servidor anonimiza a conta, encerra as sessões e envia o e-mail. */
export const deleteAccount = (proof: { password: string } | { challengeId: string; code: string }) => api.delete('/me', proof).then(() => {
    setBiometricHint(null);
    endSession();
  });

// ─── Biometria / WebAuthn (ficha 59) ────────────────────────────────────────

type RegistrationOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];
type AuthenticationOptions = Parameters<typeof startAuthentication>[0]['optionsJSON'];

export const webauthnCredentialsKey = ['webauthn', 'credentials'] as const;

/** Credenciais biométricas da conta (biometria ativa = pelo menos uma). */
export function useWebAuthnCredentials(enabled: boolean) {
  return useQuery({ queryKey: webauthnCredentialsKey, enabled, queryFn: () => api.get<PasskeyDto[]>('/auth/webauthn/credentials') });
}

/** Marca o resultado: cancelado pelo usuário (não é erro a exibir) ou falha de leitura. */
export const isBiometricCancelled = (error: unknown) =>
  error instanceof WebAuthnError ? error.name === 'NotAllowedError' || error.code === 'ERROR_CEREMONY_ABORTED' : (error as { name?: string })?.name === 'NotAllowedError';

/** Cadastra a biometria deste aparelho (Face ID / Touch ID / digital) na conta logada. */
export async function registerBiometric(reauth: { password?: string; challengeId?: string; code?: string } = {}, deviceName?: string) {
  // Contas com senha confirmam a senha; contas sem senha, o código enviado ao contato verificado.
  const { challengeId, options } = await api.post<WebAuthnOptionsDto>('/auth/webauthn/register/options', reauth);
  const response = await startRegistration({ optionsJSON: options as unknown as RegistrationOptions });
  const credential = await api.post<PasskeyDto>('/auth/webauthn/register/verify', { challengeId, response, deviceName });
  void queryClient.invalidateQueries({ queryKey: webauthnCredentialsKey });
  return credential;
}

export async function removeBiometric(credentialId: string) {
  await api.delete(`/auth/webauthn/credentials/${credentialId}`);
  void queryClient.invalidateQueries({ queryKey: webauthnCredentialsKey });
}

/** Atalho de login: o aparelho assina o desafio do servidor e a sessão abre sem digitar nada. */
export async function loginWithBiometric() {
  const { challengeId, options } = await api.post<WebAuthnOptionsDto>('/auth/webauthn/login/options');
  const response = await startAuthentication({ optionsJSON: options as unknown as AuthenticationOptions });
  return startSession(await api.post<MeResponse>('/auth/webauthn/login/verify', { challengeId, response }));
}

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
