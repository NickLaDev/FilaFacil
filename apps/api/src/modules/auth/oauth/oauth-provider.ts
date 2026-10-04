import * as oidc from 'openid-client';
import { importPKCS8, SignJWT } from 'jose';
import type { AppConfig } from '../../../config/app-config.js';

export type OAuthProviderId = 'google' | 'apple';

export const OAUTH_PROVIDER_LABELS: Record<OAuthProviderId, string> = { google: 'Google', apple: 'Apple' };

export interface OAuthIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export interface AuthorizationRequest {
  state: string;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
}

export interface CallbackInput {
  /** URL completa do callback (GET) ou a requisição com o corpo form_post (Apple). */
  current: URL | Request;
  codeVerifier: string;
  state: string;
  nonce: string;
}

/** Contrato de um provedor OIDC; os testes usam uma implementação falsa. */
export interface OAuthProviderClient {
  readonly id: OAuthProviderId;
  authorizationUrl(request: AuthorizationRequest): Promise<URL>;
  exchange(input: CallbackInput): Promise<OAuthIdentity>;
}

interface OidcOptions {
  id: OAuthProviderId;
  issuer: URL;
  clientId: string;
  scope: string;
  extraParams?: Record<string, string>;
  clientAuth: () => Promise<{ secret?: string; auth: oidc.ClientAuth }>;
}

/** Authorization Code + PKCE + state + nonce, com validação do ID token pela biblioteca openid-client. */
class OidcProvider implements OAuthProviderClient {
  private metadata: Promise<oidc.ServerMetadata> | null = null;

  constructor(private readonly options: OidcOptions) {}

  get id() {
    return this.options.id;
  }

  private serverMetadata() {
    this.metadata ??= oidc.discovery(this.options.issuer, this.options.clientId).then(
      config => config.serverMetadata(),
      error => {
        this.metadata = null;
        throw error;
      },
    );
    return this.metadata;
  }

  /** Configuração montada a cada uso: o segredo da Apple é um JWT de vida curta. */
  private async configuration() {
    const [metadata, { secret, auth }] = await Promise.all([this.serverMetadata(), this.options.clientAuth()]);
    return new oidc.Configuration(metadata, this.options.clientId, secret, auth);
  }

  async authorizationUrl({ state, nonce, codeChallenge, redirectUri }: AuthorizationRequest) {
    return oidc.buildAuthorizationUrl(await this.configuration(), {
      redirect_uri: redirectUri,
      scope: this.options.scope,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      ...this.options.extraParams,
    });
  }

  async exchange({ current, codeVerifier, state, nonce }: CallbackInput): Promise<OAuthIdentity> {
    const tokens = await oidc.authorizationCodeGrant(await this.configuration(), current, {
      pkceCodeVerifier: codeVerifier,
      expectedState: state,
      expectedNonce: nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error('ID token ausente.');
    return {
      subject: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : null,
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      name: typeof claims.name === 'string' ? claims.name : null,
    };
  }
}

/** Client secret da Apple: JWT ES256 assinado com a chave .p8 (validade curta, gerado sob demanda). */
async function appleClientSecret(config: AppConfig) {
  const { APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } = config.env;
  const key = await importPKCS8(APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: APPLE_KEY_ID })
    .setIssuer(APPLE_TEAM_ID)
    .setSubject(APPLE_CLIENT_ID)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

/** Só provedores com credenciais no .env entram no registro; os demais respondem "não configurado". */
export function createOAuthProviders(config: AppConfig): Map<OAuthProviderId, OAuthProviderClient> {
  const providers = new Map<OAuthProviderId, OAuthProviderClient>();
  if (config.googleConfigured) {
    const secret = config.env.GOOGLE_CLIENT_SECRET;
    providers.set(
      'google',
      new OidcProvider({
        id: 'google',
        issuer: new URL('https://accounts.google.com'),
        clientId: config.env.GOOGLE_CLIENT_ID,
        scope: 'openid email profile',
        clientAuth: async () => ({ secret, auth: oidc.ClientSecretPost(secret) }),
      }),
    );
  }
  if (config.appleConfigured) {
    providers.set(
      'apple',
      new OidcProvider({
        id: 'apple',
        issuer: new URL('https://appleid.apple.com'),
        clientId: config.env.APPLE_CLIENT_ID,
        scope: 'openid email name',
        // Com escopo de nome/e-mail, a Apple exige retorno via POST (form_post).
        extraParams: { response_mode: 'form_post' },
        clientAuth: async () => {
          const secret = await appleClientSecret(config);
          return { secret, auth: oidc.ClientSecretPost(secret) };
        },
      }),
    );
  }
  return providers;
}

export const OAUTH_PROVIDERS = Symbol('OAUTH_PROVIDERS');
