import { Injectable } from '@nestjs/common';
import { PLATFORM_SETTINGS, settingDefinition, type PlatformSettingDto, type PlatformSettingKey, type PublicFeaturesDto, type SettingImpactDto } from '@filafacil/shared';
import { conflict, notFound, unprocessable } from '../../common/http/app-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';

/** Quanto tempo o valor fica em memória: uma alteração vale em todas as instâncias em menos de 1 minuto (ficha 43). */
export const SETTINGS_CACHE_MS = 10_000;

type Value = boolean | number;

/**
 * Configurações e flags da plataforma (ficha 43): lidas do banco (com cache curto) por quem precisa, então alterar
 * vale sem deploy. O catálogo com tipo, padrão e limites fica em @filafacil/shared; alteração crítica exige confirmação
 * depois de ver o impacto.
 */
@Injectable()
export class SettingsService {
  private cache: { at: number; values: Map<string, Value> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async values(): Promise<Map<string, Value>> {
    if (this.cache && Date.now() - this.cache.at < SETTINGS_CACHE_MS) return this.cache.values;
    const rows = await this.prisma.platformSetting.findMany();
    const values = new Map<string, Value>(PLATFORM_SETTINGS.map(def => [def.key, def.default]));
    for (const row of rows) if (settingDefinition(row.key)) values.set(row.key, row.value as Value);
    this.cache = { at: Date.now(), values };
    return values;
  }

  async get<T extends Value>(key: PlatformSettingKey): Promise<T> {
    return (await this.values()).get(key) as T;
  }

  async enabled(key: PlatformSettingKey): Promise<boolean> {
    return Boolean(await this.get(key));
  }

  /** Lança 422 FEATURE_DISABLED se a funcionalidade estiver desligada. */
  async assertEnabled(key: PlatformSettingKey, message: string): Promise<void> {
    if (!(await this.enabled(key))) throw unprocessable('FEATURE_DISABLED', message);
  }

  invalidate() {
    this.cache = null;
  }

  async list(): Promise<PlatformSettingDto[]> {
    const [values, rows] = await Promise.all([this.values(), this.prisma.platformSetting.findMany()]);
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map(row => row.updatedById).filter((id): id is string => Boolean(id)) } }, select: { id: true, name: true } });
    return PLATFORM_SETTINGS.map(def => {
      const row = rows.find(item => item.key === def.key);
      return { ...def, value: values.get(def.key) as Value, updatedAt: row?.updatedAt.toISOString() ?? null, updatedByName: users.find(user => user.id === row?.updatedById)?.name ?? null };
    });
  }

  async publicFeatures(): Promise<PublicFeaturesDto> {
    const values = await this.values();
    return {
      bookings: Boolean(values.get('features.bookings')),
      reviews: Boolean(values.get('features.reviews')),
      coupons: Boolean(values.get('features.coupons')),
      cashback: Boolean(values.get('features.cashback')),
      partnerSignup: Boolean(values.get('features.partnerSignup')),
    };
  }

  private validate(key: string, value: unknown): Value {
    const def = settingDefinition(key);
    if (!def) throw notFound('Configuração não encontrada.');
    if (def.type === 'boolean') {
      if (typeof value !== 'boolean') throw unprocessable('INVALID_SETTING', 'Use verdadeiro ou falso.');
      return value;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || (def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max)) {
      throw unprocessable('INVALID_SETTING', `Use um número inteiro entre ${def.min} e ${def.max}.`);
    }
    return value;
  }

  /** O que a alteração afeta agora (mostrado antes de salvar uma alteração crítica). */
  async impact(key: string, rawValue: unknown): Promise<SettingImpactDto> {
    const value = this.validate(key, rawValue);
    const def = settingDefinition(key) as NonNullable<ReturnType<typeof settingDefinition>>;
    const current = (await this.values()).get(key);
    const base = { key, critical: Boolean(def.critical) };
    if (current === value) return { ...base, message: 'Nenhuma mudança: o valor já é este.', affected: 0 };
    const now = new Date();
    switch (key) {
      case 'features.bookings': {
        const affected = value ? 0 : await this.prisma.booking.count({ where: { status: 'confirmed', startsAt: { gt: now } } });
        return { ...base, affected, message: value ? 'Clientes voltam a reservar mesa.' : `Novas reservas ficam bloqueadas. ${affected} reserva(s) futura(s) já confirmada(s) continuam valendo e aparecem para a equipe.` };
      }
      case 'features.coupons': {
        const affected = value ? 0 : await this.prisma.coupon.count({ where: { active: true, endsAt: { gt: now } } });
        return { ...base, affected, message: value ? 'Cupons voltam a ser aceitos no checkout.' : `${affected} cupom(ns) ativo(s) deixam de ser aceitos no checkout (incluindo cupons pessoais de campanhas).` };
      }
      case 'features.cashback': {
        const affected = value ? 0 : await this.prisma.cashbackRule.count({ where: { active: true } });
        return { ...base, affected, message: value ? 'Pedidos novos voltam a gerar e usar cashback.' : `${affected} regra(s) ativa(s) deixam de gerar cashback em pedidos novos e o saldo não pode ser usado. Pedidos já feitos mantêm o combinado.` };
      }
      case 'integrations.offlineAfterSeconds': {
        const affected = await this.prisma.integration.count({ where: { enabled: true, status: 'online' } });
        return { ...base, affected, message: `Integrações sem sinal por ${value} s passam a abrir incidente (${affected} integração(ões) online agora).` };
      }
      default:
        return { ...base, message: `Passa de ${String(current)} para ${String(value)}.`, affected: 0 };
    }
  }

  async update(key: string, rawValue: unknown, actorId: string, confirm: boolean): Promise<PlatformSettingDto> {
    const value = this.validate(key, rawValue);
    const def = settingDefinition(key) as NonNullable<ReturnType<typeof settingDefinition>>;
    const before = (await this.values()).get(key);
    if (def.critical && before !== value && !confirm) {
      const impact = await this.impact(key, value);
      throw conflict('CONFIRMATION_REQUIRED', `Alteração crítica: ${impact.message} Confirme para salvar.`, [{ field: key, message: impact.message }]);
    }
    await this.prisma.$transaction(async tx => {
      await tx.platformSetting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue, updatedById: actorId }, update: { value: value as Prisma.InputJsonValue, updatedById: actorId } });
      await this.audit.record({ action: 'settings.updated', targetType: 'setting', targetId: key, summary: `${def.label}: ${String(before)} → ${String(value)}`, details: { key, before, after: value } }, tx);
    });
    this.invalidate();
    return (await this.list()).find(item => item.key === key) as PlatformSettingDto;
  }
}
