import { readFileSync } from 'node:fs';
import { API_LOG } from './env';

/** Linhas do log da API (sem cores ANSI) escritas depois de `since` (ver otpMark()). */
export function logSince(since: number): string[] {
  return readFileSync(API_LOG).subarray(since).toString('utf8').replace(/\u001b\[[0-9;]*m/g, '').split('\n');
}
