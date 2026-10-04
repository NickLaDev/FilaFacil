import { Injectable } from '@nestjs/common';
import { tooManyRequests } from '../../common/http/app-error.js';

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED = 10_000;

/**
 * Limite de tentativas erradas por identificador (e-mail), somado ao rate limit por IP.
 * Em memória: suficiente para uma instância; com várias réplicas, trocar por Redis.
 */
@Injectable()
export class LoginAttemptsService {
  private readonly failures = new Map<string, { count: number; firstAt: number }>();

  assertAllowed(identifier: string) {
    const entry = this.current(identifier);
    if (entry && entry.count >= MAX_FAILURES) {
      throw tooManyRequests('TOO_MANY_LOGIN_ATTEMPTS', 'Muitas tentativas de login. Aguarde 15 minutos ou entre com código.');
    }
  }

  registerFailure(identifier: string) {
    const entry = this.current(identifier);
    if (entry) entry.count += 1;
    else {
      if (this.failures.size >= MAX_TRACKED) this.prune();
      this.failures.set(identifier, { count: 1, firstAt: Date.now() });
    }
  }

  reset(identifier: string) {
    this.failures.delete(identifier);
  }

  private current(identifier: string) {
    const entry = this.failures.get(identifier);
    if (entry && Date.now() - entry.firstAt > WINDOW_MS) {
      this.failures.delete(identifier);
      return undefined;
    }
    return entry;
  }

  private prune() {
    const now = Date.now();
    for (const [key, entry] of this.failures) if (now - entry.firstAt > WINDOW_MS) this.failures.delete(key);
    if (this.failures.size >= MAX_TRACKED) this.failures.clear();
  }
}
