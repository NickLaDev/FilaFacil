import { Injectable } from '@nestjs/common';
import {
  isStrongPassword,
  isValidCpf,
  isValidEmail,
  isValidPhone,
  normalizeEmail,
  normalizePhone,
  ROLE_DEFAULT_PERMISSIONS,
  type OtpChallengeResponse,
  type OtpChannel,
} from '@filafacil/shared';
import { AppError, badRequest, conflict, notFound, serviceUnavailable, unauthorized, unprocessable } from '../../common/http/app-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { CpfProtector } from './cpf-protector.service.js';
import type { LoginDto, RegisterDto } from './dto/auth.dto.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import { OtpService } from './otp.service.js';
import { PasswordHasher } from './password-hasher.service.js';
import { SessionService, suspendedError } from './session.service.js';

const CONFLICT_MESSAGES = {
  cpf: { code: 'CPF_ALREADY_REGISTERED', message: 'Este CPF já possui cadastro. Entre na sua conta.' },
  email: { code: 'EMAIL_IN_USE', message: 'Este e-mail já está em uso por outra conta.' },
  phone: { code: 'PHONE_IN_USE', message: 'Este celular já está em uso por outra conta.' },
} as const;

type ConflictField = keyof typeof CONFLICT_MESSAGES;

const conflictFor = (field: ConflictField) =>
  conflict(CONFLICT_MESSAGES[field].code, CONFLICT_MESSAGES[field].message, [{ field, message: CONFLICT_MESSAGES[field].message }]);

const invalidCredentials = () => unauthorized('INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');

/** Cadastro e verificação de credenciais. A emissão da sessão fica com o SessionService. */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordHasher,
    private readonly cpf: CpfProtector,
    private readonly otp: OtpService,
    private readonly attempts: LoginAttemptsService,
    private readonly sessions: SessionService,
  ) {}

  /** Ficha 01: nome + CPF validado e único, com e-mail+senha ou celular como forma de acesso. */
  async register(dto: RegisterDto): Promise<string> {
    if (!isValidCpf(dto.cpf)) {
      throw unprocessable('INVALID_CPF', 'CPF inválido. Confira os números digitados.', [{ field: 'cpf', message: 'CPF inválido.' }]);
    }
    const email = dto.email ? normalizeEmail(dto.email) : null;
    const phone = dto.phone ? normalizePhone(dto.phone) : null;
    const fieldErrors = [
      ...(email && !isValidEmail(email) ? [{ field: 'email', message: 'E-mail inválido.' }] : []),
      ...(phone && !isValidPhone(phone) ? [{ field: 'phone', message: 'Celular inválido.' }] : []),
      ...(!email && !phone ? [{ field: 'email', message: 'Informe e-mail ou celular.' }] : []),
      ...(email && !dto.password ? [{ field: 'password', message: 'Crie uma senha para entrar com e-mail.' }] : []),
      ...(dto.password && !isStrongPassword(dto.password) ? [{ field: 'password', message: 'A senha precisa de 8+ caracteres, com letra e número.' }] : []),
    ];
    if (fieldErrors.length) throw badRequest('VALIDATION_FAILED', 'Dados inválidos.', fieldErrors);

    const cpfHash = this.cpf.hash(dto.cpf);
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ cpfHash }, ...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
      select: { cpfHash: true, email: true, phone: true },
    });
    if (existing) throw conflictFor(existing.cpfHash === cpfHash ? 'cpf' : email && existing.email === email ? 'email' : 'phone');

    try {
      const user = await this.prisma.user.create({
        data: {
          name: dto.name,
          email,
          phone,
          passwordHash: dto.password ? await this.passwords.hash(dto.password) : null,
          cpfHash,
          cpfEncrypted: this.cpf.encrypt(dto.cpf),
          cpfMasked: this.cpf.mask(dto.cpf),
          termsAcceptedAt: new Date(),
          marketingOptIn: dto.marketingOptIn ?? false,
          permissions: { create: ROLE_DEFAULT_PERMISSIONS.client.map(permission => ({ permission })) },
        },
        select: { id: true },
      });
      return user.id;
    } catch (error) {
      // Corrida entre dois cadastros simultâneos: o índice único decide.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String(error.meta?.target ?? '');
        throw conflictFor(target.includes('cpf') ? 'cpf' : target.includes('email') ? 'email' : 'phone');
      }
      throw error;
    }
  }

  /** Ficha 06: e-mail e senha. Mensagem única para e-mail inexistente ou senha errada. */
  async verifyPassword({ email, password }: LoginDto): Promise<string> {
    const normalized = normalizeEmail(email);
    this.attempts.assertAllowed(normalized);
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, status: true, passwordHash: true },
    });
    const valid = await this.passwords.verify(user?.passwordHash ?? null, password);
    if (!user || !valid) {
      this.attempts.registerFailure(normalized);
      throw invalidCredentials();
    }
    this.attempts.reset(normalized);
    if (user.status === 'suspended') throw suspendedError();
    if (user.passwordHash && this.passwords.needsRehash(user.passwordHash)) {
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.passwords.hash(password) } });
    }
    return user.id;
  }

  /** Ficha 06: envia o código para o celular/e-mail de uma conta existente. */
  async requestLoginCode(channel: OtpChannel, rawDestination: string, ipAddress: string | undefined) {
    const destination = channel === 'phone' ? normalizePhone(rawDestination) : normalizeEmail(rawDestination);
    const valid = channel === 'phone' ? isValidPhone(destination) : isValidEmail(destination);
    if (!valid) {
      throw badRequest('VALIDATION_FAILED', 'Dados inválidos.', [
        { field: 'destination', message: channel === 'phone' ? 'Digite um celular válido com DDD.' : 'Digite um e-mail válido.' },
      ]);
    }
    const user = await this.prisma.user.findUnique({
      where: channel === 'phone' ? { phone: destination } : { email: destination },
      select: { status: true },
    });
    if (!user) throw notFound(channel === 'phone' ? 'Não encontramos uma conta com esse celular.' : 'Não encontramos uma conta com esse e-mail.');
    if (user.status === 'suspended') throw suspendedError();
    return this.otp.issue(channel, destination, ipAddress);
  }

  /** Código correto comprova a posse do contato: ele passa a constar como verificado. */
  async verifyLoginCode(challengeId: string, code: string): Promise<string> {
    const { channel, destination } = await this.otp.verify(challengeId, code);
    const user = await this.prisma.user.findUnique({
      where: channel === 'phone' ? { phone: destination } : { email: destination },
      select: { id: true, status: true, phoneVerifiedAt: true, emailVerifiedAt: true },
    });
    if (!user) throw notFound('Conta não encontrada.');
    if (user.status === 'suspended') throw suspendedError();
    const verifiedAt = channel === 'phone' ? user.phoneVerifiedAt : user.emailVerifiedAt;
    if (!verifiedAt) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: channel === 'phone' ? { phoneVerifiedAt: new Date() } : { emailVerifiedAt: new Date() },
      });
    }
    return user.id;
  }

  // ─── Verificação de contato da conta logada (ficha 65) ──────────────────────

  /** Canais pelos quais esta instalação consegue entregar códigos (a tela só oferece os disponíveis). */
  codeChannels(): Record<OtpChannel, boolean> {
    return { email: this.otp.channelAvailable('email'), phone: this.otp.channelAvailable('phone') };
  }

  /** Envia o código para o contato que a conta já tem; o destino nunca vem da requisição. */
  async requestContactVerification(userId: string, channel: OtpChannel, ipAddress: string | undefined) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true },
    });
    const destination = channel === 'phone' ? user.phone : user.email;
    if (!destination) {
      throw unprocessable('CONTACT_MISSING', channel === 'phone' ? 'Sua conta não tem celular cadastrado.' : 'Sua conta não tem e-mail cadastrado.');
    }
    if (channel === 'phone' ? user.phoneVerifiedAt : user.emailVerifiedAt) {
      throw conflict('ALREADY_VERIFIED', 'Este contato já está verificado.');
    }
    return this.otp.issue(channel, destination, ipAddress, { purpose: 'contact_verification', userId });
  }

  /** Só um código válido, emitido para esta conta e para o contato atual dela, marca como verificado. */
  async confirmContactVerification(userId: string, challengeId: string, code: string) {
    const { channel, destination } = await this.otp.verify(challengeId, code, { purpose: 'contact_verification', userId });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, phone: true } });
    // O contato pode ter sido trocado depois do envio: o código não vale para o novo valor.
    if ((channel === 'phone' ? user.phone : user.email) !== destination) {
      throw badRequest('OTP_INVALID', 'Código incorreto ou expirado.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: channel === 'phone' ? { phoneVerifiedAt: new Date() } : { emailVerifiedAt: new Date() },
    });
  }

  // ─── Recuperação de senha (ficha 44) ───────────────────────────────────────

  /**
   * Envia um código de uso único (10 min) para o contato da conta. A resposta tem sempre o mesmo formato,
   * exista ou não a conta (e mesmo com envio bloqueado por limite), para não revelar quem está cadastrado.
   */
  async requestPasswordReset(channel: OtpChannel, rawDestination: string, ipAddress: string | undefined): Promise<OtpChallengeResponse> {
    const destination = channel === 'phone' ? normalizePhone(rawDestination) : normalizeEmail(rawDestination);
    const valid = channel === 'phone' ? isValidPhone(destination) : isValidEmail(destination);
    if (!valid) {
      throw badRequest('VALIDATION_FAILED', 'Dados inválidos.', [
        { field: 'destination', message: channel === 'phone' ? 'Digite um celular válido com DDD.' : 'Digite um e-mail válido.' },
      ]);
    }
    // Canal sem provider é falha de configuração (igual para todos), não da conta.
    if (!this.otp.channelAvailable(channel)) {
      throw serviceUnavailable('OTP_DELIVERY_UNAVAILABLE', 'Envio de código indisponível no momento. Tente por outro canal.');
    }
    const user = await this.prisma.user.findUnique({
      where: channel === 'phone' ? { phone: destination } : { email: destination },
      select: { id: true, status: true },
    });
    if (user && user.status === 'active') {
      try {
        return await this.otp.issue(channel, destination, ipAddress, { purpose: 'password_reset', userId: user.id });
      } catch (error) {
        if (!(error instanceof AppError) || (error.code !== 'OTP_COOLDOWN' && error.code !== 'OTP_HOURLY_LIMIT')) throw error;
        // Reenvio em cooldown: devolve o desafio válido que já existe (o código enviado continua valendo).
        const current = await this.otp.latestValid(channel, destination, 'password_reset', user.id);
        if (current) return current;
      }
    }
    return this.otp.decoy(channel, destination, 'password_reset');
  }

  /** Código válido + senha nova forte: troca a senha, encerra todas as sessões e invalida outros códigos pendentes. */
  async confirmPasswordReset(challengeId: string, code: string, newPassword: string): Promise<void> {
    if (!isStrongPassword(newPassword)) {
      throw badRequest('VALIDATION_FAILED', 'Dados inválidos.', [{ field: 'newPassword', message: 'A senha precisa de 8+ caracteres, com letra e número.' }]);
    }
    const { channel, userId } = await this.otp.verify(challengeId, code, { purpose: 'password_reset' });
    if (!userId) throw badRequest('OTP_INVALID', 'Código incorreto ou expirado.');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, status: true } });
    if (!user || user.status !== 'active') throw badRequest('OTP_INVALID', 'Código incorreto ou expirado.');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        // Receber o código prova a posse do contato.
        data: { passwordHash: await this.passwords.hash(newPassword), ...(channel === 'phone' ? { phoneVerifiedAt: now } : { emailVerifiedAt: now }) },
      }),
      this.prisma.otpChallenge.updateMany({ where: { userId, purpose: 'password_reset', consumedAt: null }, data: { consumedAt: now } }),
      // Biometrias cadastradas com a senha antiga (possivelmente comprometida) deixam de valer.
      this.prisma.passkey.deleteMany({ where: { userId } }),
    ]);
    if (user.email) this.attempts.reset(user.email);
    await this.sessions.revokeAllForUser(userId, 'password_reset');
  }
}
