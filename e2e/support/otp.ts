import { existsSync, readFileSync, statSync } from 'node:fs';
import { API_LOG } from './env';

const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

/** Posição atual do log da API; use antes de disparar o envio do código. */
export const otpMark = () => (existsSync(API_LOG) ? statSync(API_LOG).size : 0);

type Channel = 'email' | 'phone';

/**
 * Lê o código de 6 dígitos que o provider de desenvolvimento escreveu no log da API ([E-mail dev] / [SMS dev]).
 * O log traz o destino mascarado (ex.: "j***@email.com", "(19) *****-9999"); `hint` confere o mascaramento.
 * Mecanismo legítimo do ambiente de dev: não existe código fixo.
 */
export async function waitForOtp(since: number, channel: Channel, opts: { hint?: string; timeoutMs?: number } = {}): Promise<string> {
  const tag = channel === 'email' ? '[E-mail dev]' : '[SMS dev]';
  const end = Date.now() + (opts.timeoutMs ?? 8000);
  while (Date.now() < end) {
    const text = strip(readFileSync(API_LOG).subarray(since).toString('utf8'));
    const lines = text.split('\n').filter(l => l.includes(tag) && /\b\d{6}\b/.test(l.split('→')[1] ?? ''));
    const match = lines.reverse().find(l => !opts.hint || matchesHint(l, opts.hint));
    if (match) return /\b(\d{6})\b/.exec(match.split('→')[1])![1];
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`código ${channel} não apareceu no log da API (${API_LOG}) desde ${since}`);
}

function matchesHint(line: string, hint: string) {
  const dest = line.split('→')[1]?.split(':')[0]?.trim() ?? '';
  if (hint.includes('@')) {
    const [local, domain] = hint.split('@');
    return dest.endsWith(`@${domain}`) && dest.startsWith(local[0]);
  }
  const digits = hint.replace(/\D/g, '');
  return dest.replace(/\D/g, '').endsWith(digits.slice(-4));
}
