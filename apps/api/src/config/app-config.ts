import type { Env } from './env.js';

/** Configuração tipada e já validada, injetável em qualquer provider. */
export class AppConfig {
  constructor(readonly env: Env) {}

  get isProduction() {
    return this.env.NODE_ENV === 'production';
  }

  get googleConfigured() {
    return Boolean(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET);
  }

  get appleConfigured() {
    const { APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } = this.env;
    return Boolean(APPLE_CLIENT_ID && APPLE_TEAM_ID && APPLE_KEY_ID && APPLE_PRIVATE_KEY);
  }
}
