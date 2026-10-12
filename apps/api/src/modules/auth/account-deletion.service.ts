import { Injectable, Logger } from '@nestjs/common';
import type { OtpChallengeResponse, OtpChannel } from '@filafacil/shared';
import { BRAND_NAME } from '../../common/brand.js';
import { badRequest, conflict, forbidden, unauthorized, unprocessable } from '../../common/http/app-error.js';
import { lockResource } from '../../database/advisory-lock.js';
import { PrismaService } from '../../database/prisma.service.js';
import { EmailSender } from '../notifications/message-senders.js';
import type { DeleteAccountDto } from './dto/auth.dto.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import { OtpService } from './otp.service.js';
import { PasswordHasher } from './password-hasher.service.js';
import { SessionService } from './session.service.js';

export const DELETED_ACCOUNT_NAME = 'Conta excluída';

/**
 * Ficha 53 (LGPD): exclusão da conta pelo próprio cliente. Exige nova autenticação (senha ou código enviado
 * ao contato verificado), anonimiza os dados pessoais na hora e encerra todas as sessões. Os pedidos e
 * pagamentos permanecem (registro financeiro), ligados a uma conta já sem identificação.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordHasher,
    private readonly otp: OtpService,
    private readonly attempts: LoginAttemptsService,
    private readonly sessions: SessionService,
    private readonly email: EmailSender,
  ) {}

  /** Código de confirmação para quem não tem senha (ou prefere o código); só vai para contato já verificado. */
  async requestCode(userId: string, channel: OtpChannel, ipAddress: string | undefined): Promise<OtpChallengeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true },
    });
    this.assertCustomer(user.role);
    const destination = channel === 'phone' ? user.phone : user.email;
    const verified = channel === 'phone' ? user.phoneVerifiedAt : user.emailVerifiedAt;
    if (!destination || !verified) {
      throw unprocessable('NO_VERIFIED_CONTACT', 'Verifique seu e-mail ou celular antes de pedir o código de exclusão.');
    }
    return this.otp.issue(channel, destination, ipAddress, { purpose: 'account_deletion', userId });
  }

  async delete(userId: string, dto: DeleteAccountDto): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, email: true, phone: true, passwordHash: true, deletedAt: true },
    });
    this.assertCustomer(user.role);
    if (user.deletedAt) throw unauthorized('SESSION_EXPIRED', 'Sua sessão expirou. Entre novamente.');

    await this.reauthenticate(userId, user.passwordHash, dto);

    const contacts = [user.email, user.phone].filter((value): value is string => Boolean(value));
    const now = new Date();
    await this.prisma.$transaction(async tx => {
      await lockResource(tx, `account:${userId}`);
      // Pedido em andamento, ou aguardando um pagamento ainda possível, impede a exclusão.
      const inProgress = await tx.order.count({
        where: { userId, OR: [{ status: { in: ['paid', 'preparing', 'ready'] } }, { status: 'received', payments: { some: { status: 'pending' } } }] },
      });
      if (inProgress > 0) {
        throw conflict('ACTIVE_ORDERS', 'Você tem pedidos em andamento. Aguarde a entrega ou o cancelamento para excluir a conta.');
      }
      await tx.user.update({
        where: { id: userId },
        data: {
          name: DELETED_ACCOUNT_NAME,
          email: null,
          phone: null,
          passwordHash: null,
          cpfHash: null,
          cpfEncrypted: null,
          cpfMasked: null,
          emailVerifiedAt: null,
          phoneVerifiedAt: null,
          marketingOptIn: false,
          deletedAt: now,
        },
      });
      // Reserva (fila de espera) do cliente: sai da fila e o nome/celular informados deixam de identificá-lo.
      await tx.waitlistEntry.updateMany({
        where: { customerId: userId, status: { in: ['waiting', 'notified'] } },
        data: { status: 'removed', closedAt: now },
      });
      await tx.waitlistEntry.updateMany({
        where: { customerId: userId },
        data: { name: DELETED_ACCOUNT_NAME, phone: '00000000000', customerId: null },
      });
      await tx.userPermission.deleteMany({ where: { userId } });
      await tx.userAddress.deleteMany({ where: { userId } });
      await tx.authAccount.deleteMany({ where: { userId } });
      await tx.favorite.deleteMany({ where: { userId } });
      await tx.passkey.deleteMany({ where: { userId } });
      // Códigos de login não têm dono (user_id nulo): saem pelo destino (e-mail/celular) que continham.
      await tx.otpChallenge.deleteMany({ where: { OR: [{ userId }, ...(contacts.length ? [{ destination: { in: contacts } }] : [])] } });
      await tx.webAuthnChallenge.deleteMany({ where: { userId } });
      await tx.tableCall.updateMany({ where: { userId }, data: { userId: null } });
      await tx.session.updateMany({ where: { userId }, data: { revokedAt: now, revokedReason: 'account_deleted', userAgent: null, ipAddress: null } });
    });
    await this.sessions.revokeAllForUser(userId, 'account_deleted'); // avisa os aparelhos conectados
    if (user.email) await this.sendConfirmation(user.email);
  }

  private assertCustomer(role: string) {
    if (role !== 'client') {
      throw forbidden('STAFF_ACCOUNT', 'Contas da equipe são removidas pelo administrador da plataforma.');
    }
  }

  /** Senha atual ou código recebido no contato verificado. Tentativas erradas de senha são limitadas. */
  private async reauthenticate(userId: string, passwordHash: string | null, dto: DeleteAccountDto) {
    if (dto.password !== undefined) {
      const key = `delete:${userId}`;
      this.attempts.assertAllowed(key);
      if (!(await this.passwords.verify(passwordHash, dto.password))) {
        this.attempts.registerFailure(key);
        throw unauthorized('INVALID_CREDENTIALS', 'Senha incorreta.');
      }
      this.attempts.reset(key);
      return;
    }
    if (dto.challengeId && dto.code) {
      await this.otp.verify(dto.challengeId, dto.code, { purpose: 'account_deletion', userId });
      return;
    }
    throw badRequest('REAUTH_REQUIRED', 'Confirme com sua senha ou com o código enviado.');
  }

  private async sendConfirmation(email: string) {
    if (!this.email.available) return;
    try {
      await this.email.send(
        email,
        email,
        `${BRAND_NAME}: sua conta foi excluída. Seus dados pessoais foram removidos ou anonimizados. Se não foi você, entre em contato com o suporte.`,
      );
    } catch (error) {
      this.logger.warn(`Falha ao enviar a confirmação de exclusão: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
    }
  }
}
