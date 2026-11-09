import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { INVOICE_DUE_DAY, INVOICE_REMINDER_DAYS, type BillingRunDto, type InvoiceDto, type InvoicesPage, type InvoiceStatus } from '@filafacil/shared';
import { conflict, notFound } from '../../common/http/app-error.js';
import { pageArgs, type PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { localDate } from '../../common/time/day-bounds.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { InboxService } from '../inbox/inbox.service.js';

/** A cobrança da plataforma segue o calendário de Brasília (vencimento e atraso são contados por dia civil). */
export const BILLING_TIMEZONE = 'America/Sao_Paulo';
const CYCLE_INTERVAL_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

const INVOICE_INCLUDE = { establishment: { select: { name: true } } } satisfies Prisma.InvoiceInclude;
type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

const toDto = (row: InvoiceRow, today: string): InvoiceDto => ({
  id: row.id,
  number: row.number,
  establishmentId: row.establishmentId,
  establishmentName: row.establishment.name,
  period: row.period,
  planName: row.planName,
  amountCents: row.amountCents,
  dueDate: isoDay(row.dueDate),
  // Pendente vencida já aparece como atrasada, mesmo antes da rotina gravar (o status nunca depende de ela rodar).
  status: row.status === 'pending' && isoDay(row.dueDate) < today ? 'overdue' : row.status,
  paidAt: row.paidAt?.toISOString() ?? null,
  paymentNote: row.paymentNote,
});

const money = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
const brDate = (iso: string) => iso.split('-').reverse().join('/');
const monthLabel = (period: string) => `${period.slice(5)}/${period.slice(0, 4)}`;

export interface InvoicesQuery extends PageQueryDto {
  status?: InvoiceStatus;
  establishmentId?: string;
  period?: string;
  q?: string;
}

/**
 * Faturas da plataforma (ficha 38). A rotina de cobrança (de hora em hora e sob demanda) gera a fatura mensal de cada
 * estabelecimento ativo com plano pago (única por estabelecimento e mês), marca como ATRASADA a pendente vencida e
 * avisa o estabelecimento no dia seguinte ao vencimento — e a cada 3 dias enquanto a pendência durar. A rotina é
 * idempotente: rodar duas vezes não duplica faturas nem avisos.
 */
@Injectable()
export class BillingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return; // os testes chamam `runCycle` com relógio injetado
    this.timer = setInterval(() => void this.runCycle().catch(error => this.logger.warn(`Rotina de cobrança falhou: ${String(error)}`)), CYCLE_INTERVAL_MS);
    this.timer.unref();
    void this.runCycle().catch(error => this.logger.warn(`Rotina de cobrança falhou: ${String(error)}`));
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runCycle(now = new Date()): Promise<BillingRunDto> {
    const generated = await this.generate(now);
    const markedOverdue = await this.markOverdue(now);
    const notified = await this.notifyOverdue(now);
    return { generated, markedOverdue, notified };
  }

  /** Fatura do mês corrente para cada estabelecimento ativo com plano pago. */
  async generate(now: Date): Promise<number> {
    const today = localDate(now, BILLING_TIMEZONE);
    const period = today.slice(0, 7);
    const dueDate = new Date(`${period}-${String(INVOICE_DUE_DAY).padStart(2, '0')}T00:00:00Z`);
    const establishments = await this.prisma.establishment.findMany({
      where: { status: 'active', plan: { monthlyPriceCents: { gt: 0 } }, invoices: { none: { period } } },
      select: { id: true, createdAt: true, plan: { select: { name: true, monthlyPriceCents: true } } },
    });
    let created = 0;
    for (const establishment of establishments) {
      // Casa cadastrada depois do vencimento do mês começa a ser cobrada no mês seguinte (sem fatura nascendo vencida).
      if (localDate(establishment.createdAt, BILLING_TIMEZONE) > isoDay(dueDate)) continue;
      const result = await this.prisma.invoice.createMany({
        data: [{ establishmentId: establishment.id, period, planName: establishment.plan.name, amountCents: establishment.plan.monthlyPriceCents, dueDate }],
        skipDuplicates: true,
      });
      if (result.count === 0) continue;
      created++;
      await this.inbox.notifyEstablishment(establishment.id, {
        kind: 'invoice_issued',
        title: `Fatura de ${monthLabel(period)} disponível`,
        body: `Plano ${establishment.plan.name}: ${money(establishment.plan.monthlyPriceCents)} com vencimento em ${brDate(isoDay(dueDate))}.`,
        dedupeKey: `invoice_issued:${establishment.id}:${period}`,
        requiredPermission: 'billing.view',
        email: true,
      });
    }
    return created;
  }

  /** Pendente com vencimento anterior a hoje vira atrasada. */
  async markOverdue(now: Date): Promise<number> {
    const today = new Date(`${localDate(now, BILLING_TIMEZONE)}T00:00:00Z`);
    const { count } = await this.prisma.invoice.updateMany({ where: { status: 'pending', dueDate: { lt: today } }, data: { status: 'overdue' } });
    return count;
  }

  /** Aviso ao estabelecimento: no dia seguinte ao vencimento e depois a cada 3 dias. Devolve quantos enviou. */
  async notifyOverdue(now: Date): Promise<number> {
    const due = await this.prisma.invoice.findMany({
      where: { status: 'overdue', OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lt: new Date(now.getTime() - INVOICE_REMINDER_DAYS * DAY_MS + 60_000) } }] },
      include: INVOICE_INCLUDE,
    });
    let sent = 0;
    for (const invoice of due) {
      const claimed = await this.prisma.invoice.updateMany({
        where: { id: invoice.id, status: 'overdue', lastNotifiedAt: invoice.lastNotifiedAt },
        data: { lastNotifiedAt: now },
      });
      if (claimed.count === 0) continue; // outra execução já avisou
      await this.inbox.notifyEstablishment(invoice.establishmentId, {
        kind: 'invoice_overdue',
        title: `Fatura ${monthLabel(invoice.period)} em atraso`,
        body: `A fatura ${monthLabel(invoice.period)} (${money(invoice.amountCents)}) venceu em ${brDate(isoDay(invoice.dueDate))} e segue pendente. Regularize para evitar bloqueios.`,
        refId: invoice.id,
        dedupeKey: `invoice_overdue:${invoice.id}:${isoDay(now)}`,
        requiredPermission: 'billing.view',
        email: true,
      });
      sent++;
    }
    return sent;
  }

  // ─── Plataforma ───────────────────────────────────────────────────────────

  async list(query: InvoicesQuery, now = new Date()): Promise<InvoicesPage> {
    await this.markOverdue(now);
    const today = localDate(now, BILLING_TIMEZONE);
    const base: Prisma.InvoiceWhereInput = {
      ...(query.establishmentId && { establishmentId: query.establishmentId }),
      ...(query.period && { period: query.period }),
      ...(query.q && { establishment: { name: { contains: query.q, mode: 'insensitive' } } }),
    };
    const where: Prisma.InvoiceWhereInput = { ...base, ...(query.status && { status: query.status }) };
    const [rows, total, grouped, overdue] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({ where, orderBy: [{ dueDate: 'desc' }, { number: 'desc' }], ...pageArgs(query), include: INVOICE_INCLUDE }),
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.groupBy({ by: ['status'], where: base, orderBy: { status: 'asc' }, _count: { _all: true } }),
      this.prisma.invoice.aggregate({ where: { ...base, status: 'overdue' }, _sum: { amountCents: true } }),
    ]);
    const counts: InvoicesPage['counts'] = { all: 0, pending: 0, paid: 0, overdue: 0, cancelled: 0 };
    for (const group of grouped) {
      const n = (group._count as { _all: number })._all;
      counts[group.status] = n;
      counts.all += n;
    }
    return { items: rows.map(row => toDto(row, today)), page: query.page, pageSize: query.pageSize, total, counts, overdueCents: overdue._sum.amountCents ?? 0 };
  }

  async listForEstablishment(establishmentId: string, now = new Date()): Promise<InvoiceDto[]> {
    await this.markOverdue(now);
    const today = localDate(now, BILLING_TIMEZONE);
    const rows = await this.prisma.invoice.findMany({ where: { establishmentId }, orderBy: { dueDate: 'desc' }, take: 36, include: INVOICE_INCLUDE });
    return rows.map(row => toDto(row, today));
  }

  /** Registra o pagamento (confirmação manual da plataforma). Só pendente/atrasada; repetir é recusado. */
  async markPaid(id: string, actorId: string, note: string | undefined, now = new Date()): Promise<InvoiceDto> {
    const { count } = await this.prisma.invoice.updateMany({ where: { id, status: { in: ['pending', 'overdue'] } }, data: { status: 'paid', paidAt: now, paidById: actorId, paymentNote: note?.slice(0, 120) ?? null } });
    if (count === 0) {
      const exists = await this.prisma.invoice.findUnique({ where: { id }, select: { status: true } });
      if (!exists) throw notFound('Fatura não encontrada.');
      throw conflict('INVOICE_NOT_PAYABLE', exists.status === 'paid' ? 'Esta fatura já está paga.' : 'Esta fatura foi cancelada.');
    }
    return this.get(id, now);
  }

  async cancel(id: string, now = new Date()): Promise<InvoiceDto> {
    const { count } = await this.prisma.invoice.updateMany({ where: { id, status: { in: ['pending', 'overdue'] } }, data: { status: 'cancelled' } });
    if (count === 0) {
      const exists = await this.prisma.invoice.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw notFound('Fatura não encontrada.');
      throw conflict('INVOICE_NOT_CANCELLABLE', 'Só faturas pendentes ou atrasadas podem ser canceladas.');
    }
    return this.get(id, now);
  }

  private async get(id: string, now: Date): Promise<InvoiceDto> {
    const row = await this.prisma.invoice.findUniqueOrThrow({ where: { id }, include: INVOICE_INCLUDE });
    return toDto(row, localDate(now, BILLING_TIMEZONE));
  }
}
