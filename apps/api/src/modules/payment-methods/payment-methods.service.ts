import { Injectable, Logger } from '@nestjs/common';
import { isValidCardNumber, type CardBrand, type SavePaymentMethodRequest, type SavedPaymentMethodDto } from '@filafacil/shared';
import { conflict, notFound, serviceUnavailable, unprocessable } from '../../common/http/app-error.js';
import { lockResource } from '../../database/advisory-lock.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma, type SavedPaymentMethod } from '../../generated/prisma/client.js';
import { GatewayError, PaymentGateway } from '../payments/payment-gateway.js';

const MAX_METHODS = 10;

/** Cartão vale até o último dia do mês de validade. */
export const isExpired = (method: { expMonth: number; expYear: number }, now = new Date()) => {
  const year = now.getUTCFullYear();
  return method.expYear < year || (method.expYear === year && method.expMonth < now.getUTCMonth() + 1);
};

const toDto = (row: SavedPaymentMethod, now = new Date()): SavedPaymentMethodDto => ({
  id: row.id,
  kind: row.kind as 'credit' | 'debit',
  brand: row.brand as CardBrand,
  last4: row.last4,
  expMonth: row.expMonth,
  expYear: row.expYear,
  holderName: row.holderName,
  isDefault: row.isDefault,
  expired: isExpired(row, now),
  createdAt: row.createdAt.toISOString(),
});

/**
 * Métodos de pagamento salvos (ficha 49). O número do cartão só passa pelo servidor para ser tokenizado no cofre do
 * provedor: o banco guarda token, bandeira, final e validade — nunca o número nem o CVV (que não são registrados).
 */
@Injectable()
export class PaymentMethodsService {
  private readonly logger = new Logger(PaymentMethodsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
  ) {}

  async list(userId: string): Promise<SavedPaymentMethodDto[]> {
    const rows = await this.prisma.savedPaymentMethod.findMany({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] });
    const now = new Date();
    return rows.map(row => toDto(row, now));
  }

  async create(userId: string, dto: SavePaymentMethodRequest): Promise<SavedPaymentMethodDto> {
    if (!this.gateway.available || !this.gateway.supportsCardVault) {
      throw serviceUnavailable('CARD_VAULT_UNAVAILABLE', 'Salvar cartões não está disponível no momento.');
    }
    const number = dto.number.replace(/[\s-]/g, '');
    if (!isValidCardNumber(number)) throw unprocessable('INVALID_CARD', 'Número de cartão inválido.', [{ field: 'number', message: 'Número de cartão inválido.' }]);
    if (isExpired({ expMonth: dto.expMonth, expYear: dto.expYear })) throw unprocessable('CARD_EXPIRED', 'Este cartão está vencido.', [{ field: 'expYear', message: 'Cartão vencido.' }]);

    const existing = await this.prisma.savedPaymentMethod.count({ where: { userId } });
    if (existing >= MAX_METHODS) throw unprocessable('PAYMENT_METHOD_LIMIT', `Você pode salvar até ${MAX_METHODS} cartões.`);

    let tokenized;
    try {
      tokenized = await this.gateway.tokenizeCard({ number, holderName: dto.holderName, expMonth: dto.expMonth, expYear: dto.expYear, cvv: dto.cvv });
    } catch (error) {
      // Nada do cartão no log: só o tipo da falha.
      this.logger.warn(`Falha ao tokenizar cartão: ${error instanceof GatewayError ? `status ${error.status ?? 'n/d'}` : 'erro inesperado'}`);
      throw serviceUnavailable('CARD_VAULT_UNAVAILABLE', 'Não foi possível salvar o cartão agora. Tente novamente em instantes.');
    }

    try {
      const row = await this.prisma.$transaction(async tx => {
        await lockResource(tx, `payment-methods:${userId}`);
        const duplicate = await tx.savedPaymentMethod.findFirst({
          where: { userId, kind: dto.kind, brand: tokenized.brand, last4: tokenized.last4, expMonth: dto.expMonth, expYear: dto.expYear },
          select: { id: true },
        });
        if (duplicate) throw conflict('PAYMENT_METHOD_EXISTS', 'Este cartão já está salvo.');
        const hasDefault = (await tx.savedPaymentMethod.count({ where: { userId, isDefault: true } })) > 0;
        const makeDefault = !hasDefault || dto.makeDefault === true;
        if (makeDefault) await tx.savedPaymentMethod.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
        return tx.savedPaymentMethod.create({
          data: { userId, kind: dto.kind, brand: tokenized.brand, last4: tokenized.last4, expMonth: dto.expMonth, expYear: dto.expYear, holderName: dto.holderName.trim().toUpperCase(), token: tokenized.token, isDefault: makeDefault },
        });
      });
      return toDto(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('PAYMENT_METHOD_EXISTS', 'Este cartão já está salvo.');
      throw error;
    }
  }

  async setDefault(userId: string, id: string): Promise<SavedPaymentMethodDto> {
    const row = await this.prisma.$transaction(async tx => {
      await lockResource(tx, `payment-methods:${userId}`);
      const own = await tx.savedPaymentMethod.findFirst({ where: { id, userId } });
      if (!own) throw notFound('Método de pagamento não encontrado.');
      if (!own.isDefault) {
        await tx.savedPaymentMethod.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
        return tx.savedPaymentMethod.update({ where: { id }, data: { isDefault: true } });
      }
      return own;
    });
    return toDto(row);
  }

  /** Remove o método; se era o padrão, o mais recente dos restantes assume. */
  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await lockResource(tx, `payment-methods:${userId}`);
      const own = await tx.savedPaymentMethod.findFirst({ where: { id, userId } });
      if (!own) throw notFound('Método de pagamento não encontrado.');
      await tx.savedPaymentMethod.delete({ where: { id } });
      if (own.isDefault) {
        const next = await tx.savedPaymentMethod.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
        if (next) await tx.savedPaymentMethod.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  /** Para o pagamento do pedido: devolve token e bandeira do cartão salvo do próprio usuário. */
  async resolveForPayment(userId: string, id: string, kind: string): Promise<{ token: string; brand: string }> {
    const row = await this.prisma.savedPaymentMethod.findFirst({ where: { id, userId } });
    if (!row) throw notFound('Método de pagamento não encontrado.');
    if (row.kind !== kind) throw unprocessable('SAVED_METHOD_MISMATCH', 'Este cartão é de outro tipo (crédito/débito) que o escolhido.');
    if (isExpired(row)) throw unprocessable('CARD_EXPIRED', 'Este cartão está vencido. Escolha outro ou cadastre um novo.');
    if (!this.gateway.supportsCardVault) throw conflict('SAVED_METHOD_UNAVAILABLE', 'Cartões salvos não estão disponíveis no momento.');
    return { token: row.token, brand: row.brand };
  }
}
