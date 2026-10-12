import { Injectable } from '@nestjs/common';
import type { OtpPurpose } from '../../generated/prisma/client.js';
import { randomInt, randomUUID } from 'node:crypto';
import type { OtpChallengeResponse, OtpChannel } from '@filafacil/shared';
import { AppConfig } from '../../config/app-config.js';
import { hmacSha256Hex, safeEqualHex } from '../../common/crypto/hashing.js';
import { badRequest, serviceUnavailable, tooManyRequests } from '../../common/http/app-error.js';
import { maskEmail, maskPhone } from '../../common/masking.js';
import { PrismaService } from '../../database/prisma.service.js';
import { EmailSender, SmsSender, type MessageSender } from '../notifications/message-senders.js';
import { BRAND_NAME } from '../../common/brand.js';

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 42 * 1000;
const OTP_MAX_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

const OTP_REASONS: Record<OtpPurpose, string> = {
  login: 'código de acesso',
  contact_verification: 'código de verificação',
  password_reset: 'código para redefinir sua senha',
  account_deletion: 'código para confirmar a exclusão da conta',
  passkey_registration: 'código para ativar a biometria',
};

const invalidCode = () => badRequest('OTP_INVALID', 'Código incorreto ou expirado.');

/**
 * Códigos de uso único: gerados com CSPRNG, guardados só como HMAC (ligado ao id do desafio),
 * com expiração, limite de tentativas, intervalo mínimo entre envios e teto por hora.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly sms: SmsSender,
    private readonly email: EmailSender,
  ) {}

  private sender(channel: OtpChannel): MessageSender {
    return channel === 'phone' ? this.sms : this.email;
  }

  /** Há provider capaz de entregar o código por esse canal (ou só log de desenvolvimento)? */
  channelAvailable(channel: OtpChannel) {
    return this.sender(channel).available;
  }

  private hashCode(challengeId: string, code: string) {
    return hmacSha256Hex(this.config.env.OTP_HMAC_SECRET, `${challengeId}:${code}`);
  }

  /**
   * `destination` já normalizado (dígitos do celular ou e-mail minúsculo). Código de verificação
   * de contato fica preso ao usuário que o pediu (`userId`) e ao propósito.
   */
  async issue(
    channel: OtpChannel,
    destination: string,
    ipAddress: string | undefined,
    { purpose = 'login', userId }: { purpose?: OtpPurpose; userId?: string } = {},
  ): Promise<OtpChallengeResponse> {
    const sender = this.sender(channel);
    if (!sender.available) {
      throw serviceUnavailable('OTP_DELIVERY_UNAVAILABLE', 'Envio de código indisponível no momento. Entre com e-mail e senha.');
    }

    const now = Date.now();
    // Códigos vencidos há mais de um dia (guardam destino e IP) são descartados.
    await this.prisma.otpChallenge.deleteMany({ where: { expiresAt: { lt: new Date(now - 24 * HOUR_MS) } } });
    const recent = await this.prisma.otpChallenge.findMany({
      where: { channel, destination, purpose, createdAt: { gte: new Date(now - HOUR_MS) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const last = recent[0];
    if (last && now - last.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw tooManyRequests('OTP_COOLDOWN', 'Aguarde alguns segundos para pedir um novo código.');
    }
    if (recent.length >= OTP_MAX_PER_HOUR) {
      throw tooManyRequests('OTP_HOURLY_LIMIT', 'Limite de códigos atingido. Tente novamente mais tarde.');
    }

    const id = randomUUID();
    const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
    const challenge = await this.prisma.otpChallenge.create({
      data: {
        id,
        channel,
        purpose,
        userId: purpose === 'login' ? null : (userId ?? null),
        destination,
        codeHash: this.hashCode(id, code),
        expiresAt: new Date(now + OTP_TTL_MS),
        ipAddress: ipAddress?.slice(0, 64),
      },
    });

    const destinationMasked = channel === 'phone' ? maskPhone(destination) : maskEmail(destination);
    const reason = OTP_REASONS[purpose];
    await sender.send(destination, destinationMasked, `${BRAND_NAME}: seu ${reason} é ${code}. Ele expira em 10 minutos. Não compartilhe.`);

    return {
      challengeId: challenge.id,
      channel,
      destinationMasked,
      expiresAt: challenge.expiresAt.toISOString(),
      resendAvailableAt: new Date(now + OTP_RESEND_COOLDOWN_MS).toISOString(),
    };
  }

  /**
   * Resposta com o formato de um envio real, sem desafio nem mensagem (contas inexistentes: sem enumeração).
   * O id é estável dentro da janela de reenvio, como o de um desafio real devolvido no cooldown.
   */
  decoy(channel: OtpChannel, destination: string, purpose: OtpPurpose): OtpChallengeResponse {
    const now = Date.now();
    const bucket = Math.floor(now / OTP_RESEND_COOLDOWN_MS);
    const hex = hmacSha256Hex(this.config.env.OTP_HMAC_SECRET, `decoy:${purpose}:${channel}:${destination}:${bucket}`).slice(0, 32);
    return {
      challengeId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
      channel,
      destinationMasked: channel === 'phone' ? maskPhone(destination) : maskEmail(destination),
      expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
      resendAvailableAt: new Date(now + OTP_RESEND_COOLDOWN_MS).toISOString(),
    };
  }

  /** Desafio ainda válido mais recente do mesmo propósito (usado quando o reenvio está em cooldown). */
  async latestValid(channel: OtpChannel, destination: string, purpose: OtpPurpose, userId: string): Promise<OtpChallengeResponse | null> {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { channel, destination, purpose, userId, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) return null;
    return {
      challengeId: challenge.id,
      channel,
      destinationMasked: channel === 'phone' ? maskPhone(destination) : maskEmail(destination),
      expiresAt: challenge.expiresAt.toISOString(),
      resendAvailableAt: new Date(challenge.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS).toISOString(),
    };
  }

  /**
   * Confere o código e consome o desafio; devolve canal e destino comprovados. O propósito (e, na
   * verificação de contato, o dono) precisa bater: um código nunca vale para outra finalidade.
   */
  async verify(challengeId: string, code: string, expected: { purpose: OtpPurpose; userId?: string } = { purpose: 'login' }) {
    const challenge = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) throw invalidCode();
    if (challenge.purpose !== expected.purpose || (expected.userId !== undefined && challenge.userId !== expected.userId)) throw invalidCode();
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      throw tooManyRequests('OTP_TOO_MANY_ATTEMPTS', 'Muitas tentativas. Peça um novo código.');
    }

    // Incremento condicional: duas requisições simultâneas não conseguem passar do limite.
    const counted = await this.prisma.otpChallenge.updateMany({
      where: { id: challengeId, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) throw tooManyRequests('OTP_TOO_MANY_ATTEMPTS', 'Muitas tentativas. Peça um novo código.');

    if (!safeEqualHex(challenge.codeHash, this.hashCode(challengeId, code))) {
      if (challenge.attempts + 1 >= OTP_MAX_ATTEMPTS) {
        throw tooManyRequests('OTP_TOO_MANY_ATTEMPTS', 'Muitas tentativas. Peça um novo código.');
      }
      throw invalidCode();
    }

    const consumed = await this.prisma.otpChallenge.updateMany({
      where: { id: challengeId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) throw invalidCode();
    return { channel: challenge.channel, destination: challenge.destination, userId: challenge.userId };
  }
}
