import { Injectable } from '@nestjs/common';
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

  private hashCode(challengeId: string, code: string) {
    return hmacSha256Hex(this.config.env.OTP_HMAC_SECRET, `${challengeId}:${code}`);
  }

  /** `destination` já normalizado (dígitos do celular ou e-mail minúsculo). */
  async issue(channel: OtpChannel, destination: string, ipAddress: string | undefined): Promise<OtpChallengeResponse> {
    const sender = this.sender(channel);
    if (!sender.available) {
      throw serviceUnavailable('OTP_DELIVERY_UNAVAILABLE', 'Envio de código indisponível no momento. Entre com e-mail e senha.');
    }

    const now = Date.now();
    const recent = await this.prisma.otpChallenge.findMany({
      where: { channel, destination, createdAt: { gte: new Date(now - HOUR_MS) } },
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
        destination,
        codeHash: this.hashCode(id, code),
        expiresAt: new Date(now + OTP_TTL_MS),
        ipAddress: ipAddress?.slice(0, 64),
      },
    });

    const destinationMasked = channel === 'phone' ? maskPhone(destination) : maskEmail(destination);
    await sender.send(destination, destinationMasked, `${BRAND_NAME}: seu código de acesso é ${code}. Ele expira em 10 minutos. Não compartilhe.`);

    return {
      challengeId: challenge.id,
      channel,
      destinationMasked,
      expiresAt: challenge.expiresAt.toISOString(),
      resendAvailableAt: new Date(now + OTP_RESEND_COOLDOWN_MS).toISOString(),
    };
  }

  /** Confere o código e consome o desafio; devolve canal e destino comprovados. */
  async verify(challengeId: string, code: string) {
    const challenge = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) throw invalidCode();
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
    return { channel: challenge.channel, destination: challenge.destination };
  }
}
