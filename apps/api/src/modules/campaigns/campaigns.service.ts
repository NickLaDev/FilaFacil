import { randomInt } from 'node:crypto';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CUSTOMER_SEGMENT_LABELS, type CustomerSegment, type MyOfferDto, type SegmentCampaignDto } from '@filafacil/shared';
import { conflict, notFound, unprocessable } from '../../common/http/app-error.js';
import { localDate } from '../../common/time/day-bounds.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { InboxService } from '../inbox/inbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { CampaignBodyDto, UpdateCampaignDto } from './campaigns.dto.js';

const DISPATCH_INTERVAL_MS = 60 * 60_000;
const DAY_MS = 86_400_000;
const FREQUENT_WINDOW_DAYS = 30;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PREFIX: Record<CustomerSegment, string> = { birthday: 'NIVER', inactive: 'VOLTA', frequent: 'VIP' };
/** Pedido vendido (pago e não cancelado): a mesma regra das métricas. */
const SOLD = Prisma.sql`o.status IN ('paid', 'preparing', 'ready', 'delivered') AND o.paid_at IS NOT NULL`;

type CampaignRow = Prisma.SegmentCampaignGetPayload<object>;

const money = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
const discountLabel = (row: Pick<CampaignRow, 'discountType' | 'discountValue'>) => (row.discountType === 'percent' ? `${row.discountValue}% de desconto` : `${money(row.discountValue)} de desconto`);

/** Período em que o cliente recebe a campanha no máximo uma vez: aniversário 1x por ano; os demais 1x por mês. */
export const periodKeyFor = (segment: CustomerSegment, today: string) => (segment === 'birthday' ? today.slice(0, 4) : today.slice(0, 7));

/** Datas de aniversário que "fazem aniversário" hoje (29/02 comemora em 28/02 nos anos não bissextos). */
export function birthdayKeys(today: string): string[] {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const key = today.slice(5);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return month === 2 && day === 28 && !leap ? [key, '02-29'] : [key];
}

const randomCode = (segment: CustomerSegment) => `${CODE_PREFIX[segment]}-${Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')}`;

/**
 * Ficha 68: promoção segmentada. O gestor define o segmento (aniversariantes do dia, inativos há N dias, frequentes
 * com N pedidos em 30 dias) e o benefício; a rotina (de hora em hora, no fuso do estabelecimento) gera um cupom
 * pessoal para cada cliente do segmento e avisa no app — sem disparo manual. Cada cliente recebe no máximo uma vez
 * por período (índice único), então rodar de novo nunca duplica.
 */
@Injectable()
export class CampaignsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return; // os testes chamam `dispatch` com relógio injetado
    this.timer = setInterval(() => void this.dispatch().catch(error => this.logger.warn(`Disparo de campanhas falhou: ${String(error)}`)), DISPATCH_INTERVAL_MS);
    this.timer.unref();
    void this.dispatch().catch(error => this.logger.warn(`Disparo de campanhas falhou: ${String(error)}`));
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ─── Gestor ───────────────────────────────────────────────────────────────

  async list(establishmentId: string, now = new Date()): Promise<SegmentCampaignDto[]> {
    const rows = await this.prisma.segmentCampaign.findMany({ where: { establishmentId }, orderBy: { createdAt: 'desc' } });
    return Promise.all(rows.map(row => this.toDto(row, now)));
  }

  async create(establishmentId: string, dto: CampaignBodyDto, now = new Date()): Promise<SegmentCampaignDto> {
    this.assertValid(dto.segment, dto.discountType, dto.discountValue, dto.threshold);
    const row = await this.prisma.segmentCampaign.create({
      data: {
        establishmentId,
        name: dto.name,
        segment: dto.segment,
        threshold: dto.segment === 'birthday' ? 0 : (dto.threshold ?? 0),
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        validDays: dto.validDays,
        message: dto.message ?? '',
        active: dto.active ?? true,
      },
    });
    if (row.active) await this.dispatchCampaign(row, now); // quem já está no segmento hoje recebe na hora
    return this.toDto(row, now);
  }

  async update(establishmentId: string, id: string, dto: UpdateCampaignDto, now = new Date()): Promise<SegmentCampaignDto> {
    const current = await this.find(establishmentId, id);
    const segment = dto.segment ?? current.segment;
    this.assertValid(segment, dto.discountType ?? current.discountType, dto.discountValue ?? current.discountValue, dto.threshold ?? current.threshold);
    const row = await this.prisma.segmentCampaign.update({
      where: { id },
      data: {
        name: dto.name,
        segment: dto.segment,
        threshold: segment === 'birthday' ? 0 : dto.threshold,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        validDays: dto.validDays,
        message: dto.message,
        active: dto.active,
      },
    });
    if (row.active && !current.active) await this.dispatchCampaign(row, now);
    return this.toDto(row, now);
  }

  /** Campanha que já enviou cupons não é apagada (a taxa de uso depende do histórico): desative-a. */
  async remove(establishmentId: string, id: string): Promise<void> {
    await this.find(establishmentId, id);
    if (await this.prisma.campaignGrant.count({ where: { campaignId: id } })) throw conflict('CAMPAIGN_IN_USE', 'Esta campanha já enviou cupons. Desative-a em vez de excluir.');
    await this.prisma.segmentCampaign.delete({ where: { id } });
  }

  // ─── Cliente ──────────────────────────────────────────────────────────────

  /** Cupons pessoais recebidos pelo cliente que ainda valem (e os usados nos últimos 30 dias). */
  async myOffers(userId: string, now = new Date()): Promise<MyOfferDto[]> {
    const grants = await this.prisma.campaignGrant.findMany({
      where: { userId, coupon: { endsAt: { gt: new Date(now.getTime() - FREQUENT_WINDOW_DAYS * DAY_MS) } } },
      orderBy: { createdAt: 'desc' },
      include: {
        campaign: { select: { name: true } },
        coupon: { select: { code: true, description: true, endsAt: true, establishmentId: true, active: true, establishment: { select: { name: true } }, redemptions: { where: { userId, order: { paidAt: { not: null } } }, select: { id: true } } } },
      },
    });
    return grants
      .map(grant => ({
        code: grant.coupon.code,
        establishmentId: grant.coupon.establishmentId,
        establishmentName: grant.coupon.establishment.name,
        campaignName: grant.campaign.name,
        description: grant.coupon.description,
        endsAt: grant.coupon.endsAt.toISOString(),
        used: grant.coupon.redemptions.length > 0,
        active: grant.coupon.active && grant.coupon.endsAt > now,
      }))
      .filter(offer => offer.used || offer.active)
      .map(offer => ({ code: offer.code, establishmentId: offer.establishmentId, establishmentName: offer.establishmentName, campaignName: offer.campaignName, description: offer.description, endsAt: offer.endsAt, used: offer.used }));
  }

  // ─── Disparo automático ───────────────────────────────────────────────────

  /** Roda todas as campanhas ativas. Devolve quantos cupons enviou. */
  async dispatch(now = new Date()): Promise<number> {
    if (!(await this.settings.enabled('features.coupons'))) return 0;
    const campaigns = await this.prisma.segmentCampaign.findMany({
      where: { active: true, establishment: { status: 'active', plan: { features: { some: { feature: 'promotions' } } } } },
    });
    let sent = 0;
    for (const campaign of campaigns) {
      try {
        sent += await this.dispatchCampaign(campaign, now);
      } catch (error) {
        this.logger.warn(`Campanha ${campaign.id} falhou: ${String(error)}`);
      }
    }
    return sent;
  }

  private async dispatchCampaign(campaign: CampaignRow, now: Date): Promise<number> {
    if (!(await this.settings.enabled('features.coupons'))) return 0;
    const establishment = await this.prisma.establishment.findUnique({ where: { id: campaign.establishmentId }, select: { name: true, timezone: true } });
    if (!establishment) return 0;
    const today = localDate(now, establishment.timezone);
    const periodKey = periodKeyFor(campaign.segment, today);
    const eligible = await this.eligibleUsers(campaign, today, now);
    if (!eligible.length) return 0;
    const already = new Set((await this.prisma.campaignGrant.findMany({ where: { campaignId: campaign.id, periodKey, userId: { in: eligible } }, select: { userId: true } })).map(row => row.userId));
    let sent = 0;
    for (const userId of eligible) {
      if (already.has(userId)) continue;
      const code = await this.grant(campaign, userId, periodKey, now);
      if (!code) continue;
      sent++;
      const benefit = discountLabel(campaign);
      await this.inbox.notifyUser(userId, {
        kind: 'campaign_offer',
        title: campaign.segment === 'birthday' ? `Feliz aniversário! Presente de ${establishment.name}` : `Oferta especial de ${establishment.name}`,
        body: `${campaign.message ? `${campaign.message} ` : ''}Use o cupom ${code} e ganhe ${benefit} até ${new Date(now.getTime() + campaign.validDays * DAY_MS).toLocaleDateString('pt-BR', { timeZone: establishment.timezone })}.`,
        refId: campaign.establishmentId,
        dedupeKey: `campaign:${campaign.id}:${userId}:${periodKey}`,
      });
    }
    return sent;
  }

  /** Cria o cupom pessoal e o envio juntos; devolve null se outra execução já enviou neste período. */
  private async grant(campaign: CampaignRow, userId: string, periodKey: string, now: Date): Promise<string | null> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode(campaign.segment);
      try {
        await this.prisma.$transaction(async tx => {
          const coupon = await tx.coupon.create({
            data: {
              establishmentId: campaign.establishmentId,
              code,
              description: `${campaign.name}: ${discountLabel(campaign)}`.slice(0, 120),
              discountType: campaign.discountType,
              discountValue: campaign.discountValue,
              startsAt: now,
              endsAt: new Date(now.getTime() + campaign.validDays * DAY_MS),
              maxUses: 1,
              restrictedToUserId: userId,
            },
            select: { id: true },
          });
          await tx.campaignGrant.create({ data: { campaignId: campaign.id, userId, couponId: coupon.id, periodKey } });
        });
        return code;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        const target = JSON.stringify(error.meta ?? {});
        if (!target.includes('code')) return null; // já enviado neste período (corrida entre execuções)
      }
    }
    throw new Error('Não foi possível gerar um código de cupom único.');
  }

  /** Clientes do estabelecimento (já compraram aqui) que entram no segmento hoje. */
  private async eligibleUsers(campaign: Pick<CampaignRow, 'establishmentId' | 'segment' | 'threshold'>, today: string, now: Date): Promise<string[]> {
    const recentSince = new Date(now.getTime() - FREQUENT_WINDOW_DAYS * DAY_MS);
    const condition =
      campaign.segment === 'birthday'
        ? Prisma.sql`u.birth_date IS NOT NULL AND to_char(u.birth_date, 'MM-DD') IN (${Prisma.join(birthdayKeys(today))})`
        : campaign.segment === 'inactive'
          ? Prisma.sql`c.last_paid_at < ${new Date(now.getTime() - campaign.threshold * DAY_MS)}`
          : Prisma.sql`c.recent >= ${campaign.threshold}`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH c AS (
        SELECT o.user_id, max(o.paid_at) AS last_paid_at, count(*) FILTER (WHERE o.paid_at >= ${recentSince})::int AS recent
        FROM orders o
        WHERE o.establishment_id = ${campaign.establishmentId}::uuid AND ${SOLD}
        GROUP BY o.user_id
      )
      SELECT u.id FROM c JOIN users u ON u.id = c.user_id
      WHERE u.role = 'client' AND u.status = 'active' AND u.deleted_at IS NULL AND ${condition}
      ORDER BY u.id`);
    return rows.map(row => row.id);
  }

  private async toDto(row: CampaignRow, now: Date): Promise<SegmentCampaignDto> {
    const establishment = await this.prisma.establishment.findUniqueOrThrow({ where: { id: row.establishmentId }, select: { timezone: true } });
    const today = localDate(now, establishment.timezone);
    const [sent, used, eligible] = await Promise.all([
      this.prisma.campaignGrant.count({ where: { campaignId: row.id } }),
      this.prisma.campaignGrant.count({ where: { campaignId: row.id, coupon: { redemptions: { some: { order: { paidAt: { not: null } } } } } } }),
      this.eligibleUsers(row, today, now),
    ]);
    return {
      id: row.id,
      name: row.name,
      segment: row.segment,
      threshold: row.threshold,
      discountType: row.discountType,
      discountValue: row.discountValue,
      validDays: row.validDays,
      message: row.message,
      active: row.active,
      sent,
      used,
      usageRate: sent ? Math.round((used / sent) * 1000) / 10 : null,
      eligibleNow: eligible.length,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private assertValid(segment: CustomerSegment, type: 'percent' | 'fixed', value: number, threshold: number | undefined) {
    if (type === 'percent' && value > 100) throw unprocessable('INVALID_DISCOUNT', 'O percentual deve ficar entre 1 e 100.', [{ field: 'discountValue', message: 'Máximo 100%.' }]);
    if (segment !== 'birthday' && !threshold) {
      const what = segment === 'inactive' ? 'quantos dias sem pedir' : 'quantos pedidos em 30 dias';
      throw unprocessable('INVALID_THRESHOLD', `Informe ${what} definem o segmento "${CUSTOMER_SEGMENT_LABELS[segment]}".`, [{ field: 'threshold', message: 'Obrigatório.' }]);
    }
  }

  private async find(establishmentId: string, id: string) {
    const row = await this.prisma.segmentCampaign.findFirst({ where: { id, establishmentId } });
    if (!row) throw notFound('Campanha não encontrada.');
    return row;
  }
}
