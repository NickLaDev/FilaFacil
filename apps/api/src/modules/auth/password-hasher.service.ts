import { Injectable, type OnModuleInit } from '@nestjs/common';
import argon2 from 'argon2';

// Parâmetros mínimos recomendados pela OWASP para Argon2id (19 MiB, 2 iterações).
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordHasher implements OnModuleInit {
  private dummyHash = '';

  async onModuleInit() {
    this.dummyHash = await argon2.hash('senha-inexistente-para-equalizar-tempo', OPTIONS);
  }

  hash(password: string) {
    return argon2.hash(password, OPTIONS);
  }

  /**
   * Sem hash (usuário inexistente ou só com login por celular), verifica contra um hash fictício:
   * a resposta leva o mesmo tempo e não revela se o e-mail existe.
   */
  async verify(hash: string | null, password: string) {
    const valid = await argon2.verify(hash ?? this.dummyHash, password).catch(() => false);
    return hash !== null && valid;
  }

  needsRehash(hash: string) {
    return argon2.needsRehash(hash, OPTIONS);
  }
}
