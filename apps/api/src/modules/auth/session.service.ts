import { Injectable } from '@nestjs/common';
import { isPermission } from '@filafacil/shared';
import { AppConfig } from '../../config/app-config.js';
import { randomToken, sha256Hex } from '../../common/crypto/hashing.js';
import { forbidden, unauthorized } from '../../common/http/app-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { AuthContext, RequestMeta } from './auth.types.js';
import { TokenService, type AccessTokenPayload } from './token.service.js';

/** Janela em que o refresh token anterior ainda é aceito (abas disparando refresh ao mesmo tempo). */
const ROTATION_GRACE_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface IssuedSession {
  sessionId: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
}

export const suspendedError = () =>
  forbidden('ACCOUNT_SUSPENDED', 'Seu acesso foi suspenso pelo administrador da plataforma.');

const sessionExpired = () => unauthorized('SESSION_EXPIRED', 'Sua sessão expirou. Entre novamente.');

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
    private readonly realtime: RealtimeService,
  ) {}

  private refreshExpiry(from: Date) {
    return new Date(from.getTime() + this.config.env.REFRESH_TOKEN_TTL_DAYS * DAY_MS);
  }

  async create(userId: string, meta: RequestMeta): Promise<IssuedSession> {
    const now = new Date();
    // Sessões vencidas ou revogadas há mais de 30 dias não têm mais utilidade (e guardam IP/agente).
    await this.prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(now.getTime() - 30 * DAY_MS) } }, { revokedAt: { lt: new Date(now.getTime() - 30 * DAY_MS) } }] } });
    const refreshToken = randomToken();
    const [session] = await this.prisma.$transaction([
      this.prisma.session.create({
        data: {
          userId,
          refreshTokenHash: sha256Hex(refreshToken),
          expiresAt: this.refreshExpiry(now),
          userAgent: meta.userAgent?.slice(0, 255),
          ipAddress: meta.ipAddress?.slice(0, 64),
        },
      }),
      this.prisma.user.update({ where: { id: userId }, data: { lastAccessAt: now } }),
    ]);
    return this.issue(userId, session.id, refreshToken);
  }

  /**
   * Troca o refresh token por um novo (rotação). Reapresentar um token já trocado fora da janela
   * de tolerância indica roubo: a sessão inteira é revogada.
   */
  async refresh(refreshToken: string): Promise<IssuedSession> {
    const hash = sha256Hex(refreshToken);
    // Duas tentativas cobrem a corrida em que outra aba rotacionou entre a leitura e a escrita.
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await this.prisma.session.findFirst({
        where: { OR: [{ refreshTokenHash: hash }, { previousRefreshTokenHash: hash }] },
        select: {
          id: true,
          userId: true,
          refreshTokenHash: true,
          previousRefreshTokenHash: true,
          rotatedAt: true,
          expiresAt: true,
          revokedAt: true,
          user: { select: { status: true, deletedAt: true } },
        },
      });
      const now = new Date();
      if (!session || session.user.deletedAt) throw sessionExpired();
      // Suspensão primeiro: o app precisa saber que é bloqueio administrativo, não sessão vencida.
      if (session.user.status === 'suspended') throw suspendedError();
      if (session.revokedAt || session.expiresAt <= now) throw sessionExpired();

      const usingPrevious = session.refreshTokenHash !== hash;
      if (usingPrevious && (!session.rotatedAt || now.getTime() - session.rotatedAt.getTime() > ROTATION_GRACE_MS)) {
        await this.revoke(session.id, 'refresh_token_reuse');
        throw unauthorized('SESSION_REVOKED', 'Sessão encerrada por segurança. Entre novamente.');
      }

      const nextToken = randomToken();
      const { count } = await this.prisma.session.updateMany({
        where: { id: session.id, revokedAt: null, refreshTokenHash: session.refreshTokenHash },
        data: {
          refreshTokenHash: sha256Hex(nextToken),
          previousRefreshTokenHash: usingPrevious ? session.previousRefreshTokenHash : session.refreshTokenHash,
          rotatedAt: now,
          lastUsedAt: now,
          expiresAt: this.refreshExpiry(now),
        },
      });
      if (count === 1) {
        await this.prisma.user.update({ where: { id: session.userId }, data: { lastAccessAt: now } });
        return this.issue(session.userId, session.id, nextToken);
      }
    }
    throw sessionExpired();
  }

  /** Resolve a sessão a partir do refresh token sem rotacionar (usado no logout). */
  async findIdByRefreshToken(refreshToken: string) {
    const hash = sha256Hex(refreshToken);
    const session = await this.prisma.session.findFirst({
      where: { OR: [{ refreshTokenHash: hash }, { previousRefreshTokenHash: hash }], revokedAt: null },
      select: { id: true, userId: true },
    });
    return session;
  }

  async revoke(sessionId: string, reason: string) {
    const session = await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedReason: reason },
      select: { userId: true },
    });
    return session.userId;
  }

  /** Derruba todas as sessões do usuário (suspensão, "sair de todos os aparelhos"). */
  async revokeAllForUser(userId: string, reason: string) {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    this.realtime.sessionRevoked(userId, reason);
  }

  /**
   * Validação feita a cada requisição: além do JWT, a sessão precisa existir, estar ativa e o
   * usuário não pode estar suspenso. Assim, suspensão e logout valem na hora, sem esperar o token expirar.
   */
  async authenticate({ userId, sessionId }: AccessTokenPayload): Promise<AuthContext> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        userId: true,
        revokedAt: true,
        expiresAt: true,
        user: { select: { name: true, role: true, status: true, deletedAt: true, permissions: { select: { permission: true } } } },
      },
    });
    if (!session || session.userId !== userId) throw sessionExpired();
    if (session.user.deletedAt) throw sessionExpired();
    if (session.user.status === 'suspended') throw suspendedError();
    if (session.revokedAt || session.expiresAt <= new Date()) throw sessionExpired();
    return {
      userId,
      sessionId,
      name: session.user.name,
      role: session.user.role,
      permissions: new Set(session.user.permissions.map(p => p.permission).filter(isPermission)),
    };
  }

  private async issue(userId: string, sessionId: string, refreshToken: string): Promise<IssuedSession> {
    const accessToken = await this.tokens.signAccessToken({ userId, sessionId });
    return { sessionId, userId, accessToken, refreshToken };
  }
}
