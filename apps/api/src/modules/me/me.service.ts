import { Injectable } from '@nestjs/common';
import { isValidEmail, isValidPhone, normalizeEmail, normalizePhone, type AddressDto, type MeResponse } from '@filafacil/shared';
import { badRequest, conflict, notFound, unprocessable } from '../../common/http/app-error.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import type { CreateAddressDto, UpdateAddressDto, UpdateProfileDto } from './dto/me.dto.js';
import { ME_INCLUDE, toAuthUser, toMemberships } from './me.mapper.js';

const MAX_ADDRESSES = 10;

const toAddressDto = ({ id, label, street, city, isDefault }: AddressDto): AddressDto => ({ id, label, street, city, isDefault });

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: ME_INCLUDE });
    if (!user) throw notFound('Conta não encontrada.');
    return { user: toAuthUser(user), memberships: toMemberships(user) };
  }

  /** Trocar e-mail ou celular invalida a verificação daquele contato. */
  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<MeResponse> {
    const current = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, phone: true } });
    const email = dto.email === undefined ? current.email : dto.email === '' ? null : normalizeEmail(dto.email);
    const phone = dto.phone === undefined ? current.phone : dto.phone === '' ? null : normalizePhone(dto.phone);

    if (email && !isValidEmail(email)) throw badRequest('VALIDATION_FAILED', 'Dados inválidos.', [{ field: 'email', message: 'E-mail inválido.' }]);
    if (phone && !isValidPhone(phone)) throw badRequest('VALIDATION_FAILED', 'Dados inválidos.', [{ field: 'phone', message: 'Celular inválido.' }]);
    if (!email && !phone) throw unprocessable('CONTACT_REQUIRED', 'Mantenha pelo menos um e-mail ou celular na conta.');

    const taken = await this.prisma.user.findFirst({
      where: { id: { not: userId }, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
      select: { email: true, phone: true },
    });
    if (taken) {
      const field = email && taken.email === email ? 'email' : 'phone';
      throw conflict(field === 'email' ? 'EMAIL_IN_USE' : 'PHONE_IN_USE', field === 'email' ? 'Este e-mail já está em uso por outra conta.' : 'Este celular já está em uso por outra conta.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        email,
        phone,
        ...(email !== current.email && { emailVerifiedAt: null }),
        ...(phone !== current.phone && { phoneVerifiedAt: null }),
      },
    });
    return this.getMe(userId);
  }

  // ─── Endereços ────────────────────────────────────────────────────────────

  async listAddresses(userId: string): Promise<AddressDto[]> {
    const addresses = await this.prisma.userAddress.findMany({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    return addresses.map(toAddressDto);
  }

  async createAddress(userId: string, dto: CreateAddressDto): Promise<AddressDto> {
    return this.prisma.$transaction(async tx => {
      const count = await tx.userAddress.count({ where: { userId } });
      if (count >= MAX_ADDRESSES) throw unprocessable('ADDRESS_LIMIT', `Você pode salvar até ${MAX_ADDRESSES} endereços.`);
      const isDefault = count === 0 || dto.isDefault === true;
      if (isDefault) await this.clearDefault(tx, userId);
      const address = await tx.userAddress.create({ data: { userId, label: dto.label, street: dto.street, city: dto.city, isDefault } });
      return toAddressDto(address);
    });
  }

  async updateAddress(userId: string, addressId: string, dto: UpdateAddressDto): Promise<AddressDto> {
    return this.prisma.$transaction(async tx => {
      await this.findOwnAddress(tx, userId, addressId);
      if (dto.isDefault === true) await this.clearDefault(tx, userId);
      // Desmarcar o padrão diretamente não é permitido: o padrão muda ao escolher outro endereço.
      const address = await tx.userAddress.update({
        where: { id: addressId },
        data: { label: dto.label, street: dto.street, city: dto.city, ...(dto.isDefault === true && { isDefault: true }) },
      });
      return toAddressDto(address);
    });
  }

  /** Excluir o endereço padrão promove o mais antigo dos restantes. */
  async deleteAddress(userId: string, addressId: string) {
    await this.prisma.$transaction(async tx => {
      const address = await this.findOwnAddress(tx, userId, addressId);
      await tx.userAddress.delete({ where: { id: addressId } });
      if (!address.isDefault) return;
      const next = await tx.userAddress.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (next) await tx.userAddress.update({ where: { id: next.id }, data: { isDefault: true } });
    });
  }

  /** O filtro por dono evita IDOR: endereço de outro usuário responde 404. */
  private async findOwnAddress(tx: PrismaTx, userId: string, addressId: string) {
    const address = await tx.userAddress.findFirst({ where: { id: addressId, userId } });
    if (!address) throw notFound('Endereço não encontrado.');
    return address;
  }

  private clearDefault(tx: PrismaTx, userId: string) {
    return tx.userAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
  }
}
