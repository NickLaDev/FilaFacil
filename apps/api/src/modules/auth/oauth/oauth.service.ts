import { Inject, Injectable } from '@nestjs/common';
import * as oidc from 'openid-client';
import { normalizeEmail, ROLE_DEFAULT_PERMISSIONS, type AuthProvidersResponse } from '@filafacil/shared';
import { AppConfig } from '../../../config/app-config.js';
import { randomToken } from '../../../common/crypto/hashing.js';
import { badRequest, serviceUnavailable } from '../../../common/http/app-error.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { suspendedError } from '../session.service.js';
import {
  OAUTH_PROVIDER_LABELS,
  OAUTH_PROVIDERS,
  type OAuthIdentity,
  type OAuthProviderClient,
  type OAuthProviderId,
} from './oauth-provider.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_NAME_LENGTH = 120;

@Injectable()
export class OAuthService {
  constructor(
    @Inject(OAUTH_PROVIDERS) private readonly providers: Map<OAuthProviderId, OAuthProviderClient>,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  status(): Pick<AuthProvidersResponse, 'google' | 'apple'> {
    return { google: this.providers.has('google'), apple: this.providers.has('apple') };
  }

  redirectUri(provider: OAuthProviderId) {
    return `${this.config.env.API_PUBLIC_URL}/auth/oauth/${provider}/callback`;
  }

  private provider(id: OAuthProviderId) {
    const provider = this.providers.get(id);
    if (!provider) {
      throw serviceUnavailable('PROVIDER_NOT_CONFIGURED', `Login com ${OAUTH_PROVIDER_LABELS[id]} não está configurado.`);
    }
    return provider;
  }

  /** Gera state/nonce/PKCE, guarda no banco (uso único) e devolve a URL do provedor. */
  async start(id: OAuthProviderId) {
    const provider = this.provider(id);
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    await this.prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await this.prisma.oAuthState.create({
      data: { state, provider: id, codeVerifier, nonce, expiresAt: new Date(Date.now() + STATE_TTL_MS) },
    });
    return provider.authorizationUrl({
      state,
      nonce,
      codeChallenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      redirectUri: this.redirectUri(id),
    });
  }

  /** Valida o retorno do provedor e devolve o id do usuário (vinculando ou criando a conta). */
  async complete(id: OAuthProviderId, state: string, current: URL | Request, fallbackName?: string | null) {
    const provider = this.provider(id);
    const stored = await this.prisma.oAuthState.findUnique({ where: { state } });
    // Consome o state antes de trocar o código: um mesmo retorno não pode ser usado duas vezes.
    const consumed = await this.prisma.oAuthState.deleteMany({ where: { state, provider: id, expiresAt: { gt: new Date() } } });
    if (!stored || consumed.count === 0) throw badRequest('OAUTH_STATE_INVALID', 'Login expirado. Tente novamente.');

    const identity = await provider.exchange({ current, codeVerifier: stored.codeVerifier, state, nonce: stored.nonce });
    return this.resolveUser(id, { ...identity, name: identity.name ?? fallbackName ?? null });
  }

  /**
   * 1) identidade já vinculada → mesma conta; 2) e-mail confirmado pelo provedor igual ao de uma conta
   * → vincula; 3) senão cria uma conta de cliente (sem CPF, que pode ser informado depois).
   */
  async resolveUser(provider: OAuthProviderId, identity: OAuthIdentity) {
    const linked = await this.prisma.authAccount.findUnique({
      where: { provider_providerSubject: { provider, providerSubject: identity.subject } },
      select: { user: { select: { id: true, status: true } } },
    });
    if (linked) {
      if (linked.user.status === 'suspended') throw suspendedError();
      return linked.user.id;
    }

    const email = identity.email && identity.emailVerified ? normalizeEmail(identity.email) : null;
    const existing = email ? await this.prisma.user.findUnique({ where: { email }, select: { id: true, status: true } }) : null;
    if (existing?.status === 'suspended') throw suspendedError();

    return this.prisma.$transaction(async tx => {
      const user =
        existing ??
        (await tx.user.create({
          data: {
            name: (identity.name?.trim() || 'Cliente').slice(0, MAX_NAME_LENGTH),
            email,
            emailVerifiedAt: email ? new Date() : null,
            permissions: { create: ROLE_DEFAULT_PERMISSIONS.client.map(permission => ({ permission })) },
          },
          select: { id: true },
        }));
      await tx.authAccount.create({ data: { userId: user.id, provider, providerSubject: identity.subject, email } });
      if (existing && email) await tx.user.update({ where: { id: existing.id }, data: { emailVerifiedAt: new Date() } });
      return user.id;
    });
  }
}
