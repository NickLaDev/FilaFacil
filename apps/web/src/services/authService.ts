import { createPersistentStore, useStore } from '@/lib/store';
import { createId } from '@/lib/utils';
import { maskCpf, onlyDigits } from '@/lib/validation';
import { CLIENT_ACCOUNTS, DEMO_VERIFICATION_CODE } from '@/data/users';
import type { Address, ClientAccount } from '@/types/user';
import { registerClientUser, removeUserByEmail } from './platformUserService';

const accountsStore = createPersistentStore('client-accounts', CLIENT_ACCOUNTS);
const sessionStore = createPersistentStore<{ accountId: string | null }>('client-session', { accountId: null });
/** Preferências do aparelho: conta lembrada e biometria (ficha 59). */
const deviceStore = createPersistentStore<{ rememberedAccountId: string | null; biometricAccountId: string | null }>(
  'client-device',
  { rememberedAccountId: null, biometricAccountId: null },
);

/** Validade do código de recuperação de senha (ficha 44). */
export const RECOVERY_CODE_TTL_MS = 30 * 60 * 1000;
/** Intervalo mínimo para reenviar um código (ficha 65). */
export const RESEND_COOLDOWN_SECONDS = 42;

const MOCK_LATENCY_MS = 700;
const wait = (ms = MOCK_LATENCY_MS) => new Promise(resolve => setTimeout(resolve, ms));

const updateAccount = (id: string, patch: (account: ClientAccount) => Partial<ClientAccount>) =>
  accountsStore.set(prev => prev.map(a => (a.id === id ? { ...a, ...patch(a) } : a)));

// ─── Sessão ─────────────────────────────────────────────────────────────────

/** Sessão persistida: o cliente continua logado ao reabrir o app (ficha 06). */
export function useCurrentAccount() {
  const { accountId } = useStore(sessionStore);
  const accounts = useStore(accountsStore);
  return accounts.find(a => a.id === accountId) ?? null;
}

export const useDevice = () => useStore(deviceStore);

export function useRememberedAccount() {
  const { rememberedAccountId } = useDevice();
  const accounts = useStore(accountsStore);
  return accounts.find(a => a.id === rememberedAccountId) ?? null;
}

function startSession(accountId: string) {
  sessionStore.set({ accountId });
  deviceStore.set(prev => ({ ...prev, rememberedAccountId: accountId }));
}

export function logout() {
  sessionStore.set({ accountId: null });
}

export const isAccountVerified = (account: ClientAccount) => account.emailVerified || account.phoneVerified;

// ─── Login ──────────────────────────────────────────────────────────────────

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const findAccountByEmail = (email: string) =>
  accountsStore.get().find(a => a.email && normalizeEmail(a.email) === normalizeEmail(email)) ?? null;

export const findAccountByPhone = (phone: string) =>
  accountsStore.get().find(a => a.phone && onlyDigits(a.phone) === onlyDigits(phone)) ?? null;

/**
 * Mock: aceita qualquer senha válida (≥ 8) para e-mail cadastrado. A conferência real
 * da senha é do backend — nenhuma senha é guardada no navegador.
 */
export async function loginWithEmail(email: string, password: string) {
  await wait();
  const account = findAccountByEmail(email);
  if (!account || password.length < 8) return null;
  startSession(account.id);
  return account;
}

/** Chamado depois que o código enviado por SMS foi confirmado. */
export function loginWithPhone(phone: string) {
  const account = findAccountByPhone(phone);
  if (account) startSession(account.id);
  return account;
}

/** Login por código enviado ao e-mail, alternativa à senha. */
export function loginWithVerifiedEmail(email: string) {
  const account = findAccountByEmail(email);
  if (account) startSession(account.id);
  return account;
}

/** Simula o retorno do OAuth do Google/Apple entrando na conta vinculada (demo). */
export async function loginWithProvider(provider: 'google' | 'apple') {
  await wait(provider === 'google' ? 900 : 700);
  const account = accountsStore.get()[0] ?? null;
  if (account) startSession(account.id);
  return account;
}

/** Atalho de biometria: só entra na conta que ativou a biometria neste aparelho. */
export function loginWithBiometrics() {
  const { biometricAccountId } = deviceStore.get();
  const account = accountsStore.get().find(a => a.id === biometricAccountId) ?? null;
  if (account) startSession(account.id);
  return account;
}

export function setBiometricEnabled(accountId: string, enabled: boolean) {
  deviceStore.set(prev => ({ ...prev, biometricAccountId: enabled ? accountId : null }));
}

/** Simula a validação no servidor do código enviado por SMS/e-mail. */
export async function verifyCode(code: string) {
  await wait(900);
  return code === DEMO_VERIFICATION_CODE;
}

// ─── Cadastro ───────────────────────────────────────────────────────────────

/** Hash do CPF — permite barrar duplicidade no mock sem guardar o documento. */
async function fingerprintCpf(cpf: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(onlyDigits(cpf)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function isCpfRegistered(cpf: string) {
  const fingerprint = await fingerprintCpf(cpf);
  return accountsStore.get().some(a => a.cpfFingerprint === fingerprint);
}

export interface SignupInput {
  name: string;
  cpf: string;
  email: string;
  phone: string;
}

export async function registerAccount(input: SignupInput) {
  await wait();
  const account: ClientAccount = {
    id: createId('acc'),
    name: input.name,
    cpfMasked: maskCpf(input.cpf),
    cpfFingerprint: await fingerprintCpf(input.cpf),
    email: input.email,
    phone: input.phone,
    emailVerified: false,
    phoneVerified: false,
    addresses: [],
    favoriteEstablishmentIds: [],
    createdAt: new Date().toISOString(),
  };
  accountsStore.set(prev => [...prev, account]);
  registerClientUser(account.name, account.email || account.phone);
  startSession(account.id);
  return account;
}

export function markContactVerified(accountId: string, channel: 'email' | 'phone') {
  updateAccount(accountId, () => (channel === 'email' ? { emailVerified: true } : { phoneVerified: true }));
}

// ─── Perfil ─────────────────────────────────────────────────────────────────

/** Trocar e-mail/telefone derruba a verificação daquele canal (ficha 65). */
export function updateProfile(accountId: string, changes: Pick<ClientAccount, 'name' | 'email' | 'phone'>) {
  updateAccount(accountId, account => ({
    ...changes,
    emailVerified: account.email === changes.email ? account.emailVerified : false,
    phoneVerified: onlyDigits(account.phone) === onlyDigits(changes.phone) ? account.phoneVerified : false,
  }));
}

export function saveAddress(accountId: string, input: Omit<Address, 'id' | 'isDefault'>) {
  updateAccount(accountId, account => ({
    addresses: [...account.addresses, { ...input, id: createId('addr'), isDefault: account.addresses.length === 0 }],
  }));
}

export function deleteAddress(accountId: string, addressId: string) {
  updateAccount(accountId, account => {
    const remaining = account.addresses.filter(a => a.id !== addressId);
    if (remaining.length && !remaining.some(a => a.isDefault)) remaining[0] = { ...remaining[0], isDefault: true };
    return { addresses: remaining };
  });
}

export function setDefaultAddress(accountId: string, addressId: string) {
  updateAccount(accountId, account => ({ addresses: account.addresses.map(a => ({ ...a, isDefault: a.id === addressId })) }));
}

/** Favoritos ficam na conta (não no aparelho), então acompanham o cliente em outro dispositivo (ficha 45). */
export function toggleFavorite(accountId: string, establishmentId: string) {
  updateAccount(accountId, account => ({
    favoriteEstablishmentIds: account.favoriteEstablishmentIds.includes(establishmentId)
      ? account.favoriteEstablishmentIds.filter(id => id !== establishmentId)
      : [...account.favoriteEstablishmentIds, establishmentId],
  }));
}

// ─── Recuperação de senha e LGPD ────────────────────────────────────────────

export async function requestPasswordRecovery(channel: 'email' | 'sms', destination: string) {
  await wait();
  return channel === 'email' ? findAccountByEmail(destination) !== null : findAccountByPhone(destination) !== null;
}

export async function resetPassword() {
  await wait();
}

/**
 * Exclusão a pedido do titular (ficha 53). O backend anonimiza os dados em até 30 dias
 * e envia a confirmação por e-mail; aqui a conta sai da base mockada e a sessão termina.
 */
export async function deleteAccount(accountId: string) {
  await wait();
  const account = accountsStore.get().find(a => a.id === accountId);
  accountsStore.set(prev => prev.filter(a => a.id !== accountId));
  if (account) removeUserByEmail(account.email || account.phone);
  sessionStore.set({ accountId: null });
  deviceStore.set({ rememberedAccountId: null, biometricAccountId: null });
}
