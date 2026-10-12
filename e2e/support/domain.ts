import { Api } from './api';
import { ACCOUNTS, PASSWORD, SEED } from './env';
import { otpMark, waitForOtp } from './otp';

/** CPF válido aleatório (dados fictícios de teste). */
export function randomCpf(): string {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  if (new Set(d).size === 1) d[0] = (d[0] + 1) % 10;
  for (const len of [9, 10]) {
    const sum = d.slice(0, len).reduce((a, n, i) => a + n * (len + 1 - i), 0);
    const r = (sum * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join('');
}

export const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface Disposable {
  api: Api;
  email: string;
  password: string;
  cpf: string;
  name: string;
  id: string;
}

/** Conta descartável (cliente NÃO verificado) criada pela API real. O domínio .test nunca existe. */
export async function createDisposableAccount(opts: { password?: string; name?: string } = {}): Promise<Disposable> {
  const api = await Api.create();
  const email = `e2e-${uniq()}@example.test`;
  const password = opts.password ?? 'Senha1234x';
  const cpf = randomCpf();
  const name = opts.name ?? 'Cliente Descartavel E2E';
  const r = await api.post('auth/register', { name, cpf, email, password, acceptTerms: true });
  if (r.status !== 201) throw new Error(`register: ${r.status} ${JSON.stringify(r.body)}`);
  return { api, email, password, cpf, name, id: r.body.user.id };
}

/** Verifica o e-mail da conta logada pelo fluxo real (código lido do log de dev da API). */
export async function verifyEmail(account: Disposable) {
  const mark = otpMark();
  const sent = await account.api.post('auth/verify-contact', { channel: 'email' });
  if (sent.status >= 300) throw new Error(`verify-contact: ${sent.status} ${JSON.stringify(sent.body)}`);
  const code = await waitForOtp(mark, 'email', { hint: account.email });
  const ok = await account.api.post('auth/verify-contact/confirm', { challengeId: sent.body.challengeId, code });
  if (ok.status >= 300) throw new Error(`verify confirm: ${ok.status} ${JSON.stringify(ok.body)}`);
}

export const managerApi = () => Api.as(ACCOUNTS.manager.email);
export const attendantApi = () => Api.as(ACCOUNTS.attendant.email);
export const clientApi = (account: { email: string } = ACCOUNTS.client) => Api.as(account.email);

/** Libera uma mesa (ignora erro se já livre). */
export async function releaseTable(staff: Api, establishmentId: string, tableId: string) {
  await staff.post(`establishments/${establishmentId}/tables/${tableId}/release`);
}

export async function tableMap(staff: Api, establishmentId: string) {
  return (await staff.get(`establishments/${establishmentId}/table-map`)).body;
}

export { PASSWORD, SEED };

/** Espera passar o intervalo mínimo (42 s) entre códigos para o mesmo destino (consulta somente leitura ao banco E2E). */
export async function waitOtpCooldown(destination: string) {
  const { dbOne } = await import('./db');
  const key = destination.replace(/\D/g, '') || destination;
  for (let i = 0; i < 60; i++) {
    const row = await dbOne<{ age: number }>("select extract(epoch from (now() - max(created_at)))::float as age from otp_challenges where destination = $1 or destination = $2", [key, destination]);
    if (row?.age == null || row.age > 44) return;
    await new Promise(r => setTimeout(r, 1500));
  }
}
