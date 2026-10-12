import { Injectable } from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { OtpChallengeResponse, OtpChannel, PasskeyDto, WebAuthnOptionsDto } from '@filafacil/shared';
import { BRAND_NAME } from '../../common/brand.js';
import { badRequest, conflict, notFound, unauthorized, unprocessable } from '../../common/http/app-error.js';
import { AppConfig } from '../../config/app-config.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import { OtpService } from './otp.service.js';
import { PasswordHasher } from './password-hasher.service.js';
import type { AuthenticatorTransport } from '@simplewebauthn/server';
import { suspendedError } from './session.service.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_PASSKEYS = 10;

const failed = () => badRequest('WEBAUTHN_FAILED', 'Não foi possível validar a biometria. Tente novamente ou entre com sua senha.');

/**
 * Ficha 59: login por biometria via WebAuthn. O servidor emite um desafio aleatório de uso único e curto,
 * confere assinatura, origem, domínio (RP ID), verificação do usuário (biometria/PIN do aparelho) e o
 * contador da credencial. Só a chave pública fica guardada; sem credencial válida não há sessão.
 */
@Injectable()
export class WebAuthnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly passwords: PasswordHasher,
    private readonly attempts: LoginAttemptsService,
    private readonly otp: OtpService,
  ) {}

  private get rpID() {
    return this.config.env.WEBAUTHN_RP_ID || new URL(this.config.env.WEB_ORIGIN).hostname;
  }

  private get origin() {
    return new URL(this.config.env.WEB_ORIGIN).origin;
  }

  // ─── Cadastro (ativar biometria) ──────────────────────────────────────────

  /** Conta sem senha: código de confirmação enviado ao contato já verificado (nunca a um destino da requisição). */
  async requestRegistrationCode(userId: string, channel: OtpChannel, ipAddress: string | undefined): Promise<OtpChallengeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true },
    });
    const destination = channel === 'phone' ? user.phone : user.email;
    const verified = channel === 'phone' ? user.phoneVerifiedAt : user.emailVerifiedAt;
    if (!destination || !verified) {
      throw unprocessable('NO_VERIFIED_CONTACT', 'Verifique seu e-mail ou celular antes de ativar a biometria.');
    }
    return this.otp.issue(channel, destination, ipAddress, { purpose: 'passkey_registration', userId });
  }

  async registrationOptions(userId: string, reauth: { password?: string; challengeId?: string; code?: string } = {}): Promise<WebAuthnOptionsDto> {
    const { password } = reauth;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true, passwordHash: true, passkeys: { select: { credentialId: true, transports: true } } },
    });
    // Quem tem senha confirma a identidade antes de cadastrar um novo aparelho (uma sessão roubada não basta).
    if (user.passwordHash) {
      const key = `passkey:${userId}`;
      this.attempts.assertAllowed(key);
      if (password === undefined || !(await this.passwords.verify(user.passwordHash, password))) {
        this.attempts.registerFailure(key);
        throw unauthorized('INVALID_CREDENTIALS', 'Confirme sua senha para ativar a biometria.');
      }
      this.attempts.reset(key);
    } else if (reauth.challengeId && reauth.code) {
      // Sem senha (celular/Google/Apple): o código enviado ao contato verificado faz o papel da senha.
      await this.otp.verify(reauth.challengeId, reauth.code, { purpose: 'passkey_registration', userId });
    } else {
      throw badRequest('REAUTH_REQUIRED', 'Confirme com o código enviado ao seu contato para ativar a biometria.');
    }
    if (user.passkeys.length >= MAX_PASSKEYS) {
      throw unprocessable('PASSKEY_LIMIT', `Você pode cadastrar até ${MAX_PASSKEYS} aparelhos.`);
    }
    const options = await generateRegistrationOptions({
      rpName: BRAND_NAME,
      rpID: this.rpID,
      userName: user.email ?? user.phone ?? user.id,
      userDisplayName: user.name,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: user.passkeys.map(key => ({ id: key.credentialId, transports: key.transports })),
      // Credencial "descobrível" (login sem digitar identificador) e verificação obrigatória do usuário.
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    return { challengeId: await this.saveChallenge('registration', options.challenge, userId), options: { ...options } };
  }

  async verifyRegistration(userId: string, challengeId: string, response: RegistrationResponseJSON, deviceName?: string): Promise<PasskeyDto> {
    const challenge = await this.consumeChallenge(challengeId, 'registration', userId);
    let info;
    try {
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
      if (!result.verified) throw failed();
      info = result.registrationInfo;
    } catch {
      throw failed();
    }
    const { credential } = info;
    const exists = await this.prisma.passkey.findUnique({ where: { credentialId: credential.id }, select: { id: true } });
    if (exists) throw conflict('PASSKEY_EXISTS', 'Esta credencial já está cadastrada.');
    try {
      const saved = await this.prisma.passkey.create({
        data: {
          userId,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: BigInt(credential.counter),
          transports: credential.transports ?? [],
          ...(deviceName ? { deviceName: deviceName.slice(0, 60) } : {}),
        },
      });
      return this.toDto(saved);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('PASSKEY_EXISTS', 'Esta credencial já está cadastrada.');
      }
      throw error;
    }
  }

  // ─── Login ────────────────────────────────────────────────────────────────

  async authenticationOptions(): Promise<WebAuthnOptionsDto> {
    const options = await generateAuthenticationOptions({ rpID: this.rpID, userVerification: 'required' });
    return { challengeId: await this.saveChallenge('authentication', options.challenge, null), options: { ...options } };
  }

  /** Confere a asserção e devolve o id do usuário para abrir a sessão. */
  async verifyAuthentication(challengeId: string, response: AuthenticationResponseJSON): Promise<string> {
    const challenge = await this.consumeChallenge(challengeId, 'authentication', null);
    const passkey = await this.prisma.passkey.findUnique({
      where: { credentialId: String(response?.id ?? '') },
      include: { user: { select: { id: true, status: true, deletedAt: true } } },
    });
    if (!passkey || passkey.user.deletedAt) throw failed();
    let newCounter: number;
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(passkey.publicKey),
          counter: Number(passkey.counter),
          transports: passkey.transports as AuthenticatorTransport[],
        },
      });
      if (!result.verified) throw failed();
      newCounter = result.authenticationInfo.newCounter;
    } catch {
      throw failed();
    }
    if (passkey.user.status === 'suspended') throw suspendedError();
    // Contador só avança (atômico): duas asserções iguais em paralelo não passam as duas.
    const updated = await this.prisma.passkey.updateMany({
      where: { id: passkey.id, ...(newCounter > 0 ? { counter: { lt: BigInt(newCounter) } } : {}) },
      data: { counter: BigInt(newCounter), lastUsedAt: new Date() },
    });
    if (updated.count === 0) throw failed();
    return passkey.userId;
  }

  // ─── Gestão (desativar biometria) ─────────────────────────────────────────

  async list(userId: string): Promise<PasskeyDto[]> {
    const keys = await this.prisma.passkey.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    return keys.map(key => this.toDto(key));
  }

  async remove(userId: string, passkeyId: string) {
    const removed = await this.prisma.passkey.deleteMany({ where: { id: passkeyId, userId } });
    if (removed.count === 0) throw notFound('Credencial não encontrada.');
  }

  // ─── Desafios ─────────────────────────────────────────────────────────────

  private async saveChallenge(purpose: 'registration' | 'authentication', challenge: string, userId: string | null) {
    const now = new Date();
    await this.prisma.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: now } } });
    const row = await this.prisma.webAuthnChallenge.create({
      data: { purpose, challenge, userId, expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS) },
      select: { id: true },
    });
    return row.id;
  }

  /** Lê e apaga o desafio numa só operação: uso único, no propósito certo e (no cadastro) do dono. */
  private async consumeChallenge(id: string, purpose: 'registration' | 'authentication', userId: string | null): Promise<string> {
    const row = await this.prisma.webAuthnChallenge.findFirst({
      where: { id, purpose, userId, expiresAt: { gt: new Date() } },
      select: { challenge: true },
    });
    if (!row) throw failed();
    const consumed = await this.prisma.webAuthnChallenge.deleteMany({ where: { id } });
    if (consumed.count === 0) throw failed();
    return row.challenge;
  }

  private toDto(key: { id: string; deviceName: string; createdAt: Date; lastUsedAt: Date | null }): PasskeyDto {
    return { id: key.id, deviceName: key.deviceName, createdAt: key.createdAt.toISOString(), lastUsedAt: key.lastUsedAt?.toISOString() ?? null };
  }
}
