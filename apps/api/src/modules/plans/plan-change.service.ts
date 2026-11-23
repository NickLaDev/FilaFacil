import { Injectable } from '@nestjs/common';
import { prorationFor, type PlanChangeResultDto, type PlanComparisonDto, type PlanFeature, type PlanOptionDto } from '@filafacil/shared';
import { conflict, notFound, unprocessable } from '../../common/http/app-error.js';
import { localDate } from '../../common/time/day-bounds.js';
import { lockResource } from '../../database/advisory-lock.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { BILLING_TIMEZONE } from '../billing/billing.service.js';
import { ChangeLogService } from '../establishment-history/change-log.service.js';
import { InboxService } from '../inbox/inbox.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { SettingsService } from '../settings/settings.service.js';

const PRORATION_DUE_DAYS = 5;
const money = (cents: number) => `R$ ${(Math.abs(cents) / 100).toFixed(2).replace('.', ',')}`;

/** Dias restantes do mês (contando hoje) e total de dias, pelo calendário de cobrança (Brasília). */
export function monthPosition(now: Date) {
  const today = localDate(now, BILLING_TIMEZONE);
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { today, period: today.slice(0, 7), daysInMonth, remainingDays: daysInMonth - day + 1 };
}

/**
 * Fichas 58 e 69: comparação de planos lado a lado e troca self-service pelo gestor. Os recursos valem na hora (o
 * acesso lê o plano do banco a cada requisição). Se a mensalidade do mês já foi emitida, a diferença dos dias
 * restantes vira uma cobrança proporcional (upgrade) ou um crédito abatido na próxima mensalidade (downgrade).
 */
@Injectable()
export class PlanChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly changeLog: ChangeLogService,
    private readonly inbox: InboxService,
    private readonly realtime: RealtimeService,
  ) {}

  async compare(establishmentId: string, now = new Date()): Promise<PlanComparisonDto> {
    return this.compareWith(this.prisma, establishmentId, now);
  }

  async change(establishmentId: string, planId: string, actor: AuthContext, now = new Date()): Promise<PlanChangeResultDto> {
    await this.settings.assertEnabled('features.planSelfService', 'A troca de plano pelo painel está desativada; fale com o suporte.');
    const result = await this.prisma.$transaction(async tx => {
      await lockResource(tx, `billing:${establishmentId}`);
      const comparison = await this.compareWith(tx, establishmentId, now);
      const target = comparison.plans.find(plan => plan.id === planId);
      if (!target) throw notFound('Plano não encontrado.');
      if (target.current) throw conflict('SAME_PLAN', 'Este já é o plano atual.');
      if (target.blockers.length) throw unprocessable('PLAN_LIMIT_EXCEEDED', target.blockers.join(' '));
      const current = comparison.plans.find(plan => plan.current)!;
      const { period, today } = monthPosition(now);

      let invoiceId: string | null = null;
      if (target.prorationCents > 0) {
        const due = new Date(`${today}T00:00:00Z`);
        due.setUTCDate(due.getUTCDate() + PRORATION_DUE_DAYS);
        invoiceId = (await tx.invoice.create({ data: { establishmentId, period, kind: 'proration', planName: target.name, amountCents: target.prorationCents, dueDate: due }, select: { id: true } })).id;
      } else if (target.prorationCents < 0) {
        const [year, month] = period.split('-').map(Number) as [number, number];
        const nextMonth = new Date(Date.UTC(year, month, 1));
        invoiceId = (await tx.invoice.create({ data: { establishmentId, period, kind: 'credit', planName: target.name, amountCents: target.prorationCents, dueDate: nextMonth }, select: { id: true } })).id;
      }

      await tx.establishment.update({ where: { id: establishmentId }, data: { planId: target.id } });
      await tx.planChange.create({ data: { establishmentId, fromPlanName: current.name, toPlanId: target.id, toPlanName: target.name, prorationCents: target.prorationCents, invoiceId, actorId: actor.userId } });
      await this.changeLog.record(tx, establishmentId, { userId: actor.userId, name: actor.name }, [{ field: 'plan', oldValue: current.name, newValue: target.name }]);
      await this.audit.record(
        {
          action: 'plan.self_service_change',
          targetType: 'establishment',
          targetId: establishmentId,
          summary: `Plano trocado pelo gestor: ${current.name} → ${target.name} (${target.prorationCents >= 0 ? 'cobrança' : 'crédito'} proporcional ${money(target.prorationCents)})`,
          details: { from: current.name, to: target.name, prorationCents: target.prorationCents, remainingDays: comparison.remainingDays, daysInMonth: comparison.daysInMonth },
        },
        tx,
      );
      return { current, target, invoiceId };
    });

    this.realtime.establishmentUpdated(establishmentId);
    const { current, target } = result;
    const proration =
      target.prorationCents > 0 ? `Cobrança proporcional de ${money(target.prorationCents)} gerada.` : target.prorationCents < 0 ? `Crédito de ${money(target.prorationCents)} será abatido na próxima mensalidade.` : 'Sem diferença a cobrar neste mês.';
    await this.inbox.notifyEstablishment(establishmentId, {
      kind: 'plan_changed',
      title: `Plano alterado para ${target.name}`,
      body: `O plano mudou de ${current.name} para ${target.name} e os recursos já estão valendo. ${proration}`,
      refId: result.invoiceId,
      requiredPermission: 'plan.manage',
      email: true,
    });
    return { planId: target.id, planName: target.name, features: target.features, prorationCents: target.prorationCents, invoiceId: result.invoiceId };
  }

  private async compareWith(client: PrismaService | PrismaTx, establishmentId: string, now: Date): Promise<PlanComparisonDto> {
    const establishment = await client.establishment.findUnique({
      where: { id: establishmentId },
      select: { planId: true, organizationId: true, plan: { select: { monthlyPriceCents: true } } },
    });
    if (!establishment) throw notFound('Estabelecimento não encontrado.');
    const { period, daysInMonth, remainingDays } = monthPosition(now);
    const [plans, tables, staff, units, billedThisMonth] = await Promise.all([
      client.plan.findMany({ orderBy: [{ monthlyPriceCents: 'asc' }, { name: 'asc' }], include: { features: { select: { feature: true } } } }),
      client.diningTable.count({ where: { establishmentId } }),
      client.establishmentMembership.count({ where: { establishmentId, organizationId: null, user: { role: { not: 'admin' }, deletedAt: null } } }),
      client.establishment.count({ where: { organizationId: establishment.organizationId, status: { not: 'suspended' } } }),
      client.invoice.count({ where: { establishmentId, period, kind: 'monthly', status: { not: 'cancelled' } } }),
    ]);
    const options = plans.map((plan): PlanOptionDto => {
      const current = plan.id === establishment.planId;
      const blockers: string[] = [];
      if (!current) {
        if (tables > plan.maxTables) blockers.push(`Você tem ${tables} mesas e o plano ${plan.name} permite ${plan.maxTables}.`);
        if (staff > plan.maxStaff) blockers.push(`Você tem ${staff} pessoas na equipe e o plano ${plan.name} permite ${plan.maxStaff}.`);
        if (units > plan.maxUnits) blockers.push(`Sua rede tem ${units} unidades e o plano ${plan.name} permite ${plan.maxUnits}.`);
      }
      return {
        id: plan.id,
        name: plan.name,
        monthlyPriceCents: plan.monthlyPriceCents,
        limits: { units: plan.maxUnits, tables: plan.maxTables, staff: plan.maxStaff },
        features: plan.features.map(grant => grant.feature as PlanFeature),
        current,
        // Sem mensalidade emitida neste mês, o novo preço simplesmente vale na próxima fatura (nada proporcional).
        prorationCents: current || !billedThisMonth ? 0 : prorationFor(establishment.plan.monthlyPriceCents, plan.monthlyPriceCents, remainingDays, daysInMonth),
        blockers,
      };
    });
    return { establishmentId, currentPlanId: establishment.planId, remainingDays, daysInMonth, plans: options };
  }
}
