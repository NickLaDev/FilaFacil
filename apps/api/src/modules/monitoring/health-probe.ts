import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const PROBE_TIMEOUT_MS = 5_000;

/** Faixas internas que um teste de integração nunca pode alcançar em produção (proteção contra SSRF). */
function isPrivateAddress(address: string): boolean {
  if (address === '::1' || address === '::' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return true;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  const parts = v4.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * Confere a URL de saúde antes de usá-la: https em produção e destino que não seja rede interna (o teste é feito
 * pelo servidor, então sem isso o admin poderia sondar serviços internos). Fora de produção http/local é aceito.
 */
export async function assertSafeHealthUrl(raw: string, allowPrivate: boolean): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('URL inválida.');
  }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) throw new Error('Use uma URL https.');
  if (url.username || url.password) throw new Error('A URL não pode conter usuário ou senha.');
  if (!allowPrivate) {
    const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
    if (addresses.some(entry => isPrivateAddress(entry.address))) throw new Error('A URL aponta para uma rede interna.');
  }
  return url;
}

export interface ProbeResult {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

/** GET na URL de saúde: 2xx = disponível; qualquer outra resposta, timeout ou erro de rede = indisponível. */
export async function probeHealthUrl(raw: string, allowPrivate: boolean): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const url = await assertSafeHealthUrl(raw, allowPrivate);
    // Sem seguir redirecionamento: um 3xx para outro destino não pode furar a verificação acima.
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const latencyMs = Date.now() - started;
    await response.body?.cancel().catch(() => undefined);
    return response.status < 400 ? { ok: true, latencyMs, error: null } : { ok: false, latencyMs, error: `Resposta HTTP ${response.status}` };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message = error instanceof Error ? (error.name === 'TimeoutError' ? 'Sem resposta em 5 s' : error.message) : 'Falha de conexão';
    return { ok: false, latencyMs, error: message.slice(0, 200) };
  }
}
