import { Injectable } from '@nestjs/common';
import { PLATFORM_TIMEZONE, STAFF_ROLES, type OrganizationDetailDto, type OrganizationReportDto, type OrganizationRole, type OrganizationSummaryDto } from '@filafacil/shared';
import { conflict, forbidden, notFound, unprocessable } from '../../common/http/app-error.js';
import { localDate, zonedInstant } from '../../common/time/day-bounds.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { ChangeLogService } from '../establishment-history/change-log.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const DAY_MS = 86_400_000;
const avg = (gmv: number, orders: number) => (orders > 0 ? Math.round(gmv / orders) : 0);

/**
 * Organizações (ficha 35): redes com várias unidades. O papel `admin` da rede dá vínculo com TODAS as unidades
 * (gravado em establishment_memberships com organization_id, então todas as regras de acesso existentes valem);
 * `viewer` só lê o relatório consolidado. Vincular uma unidade à rede já estende o acesso dos admins da rede.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly changeLog: ChangeLogService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(): Promise<OrganizationSummaryDto[]> {
    const rows = await this.prisma.organization.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, createdAt: true, establishments: { select: { status: true } }, _count: { select: { members: true } } },
    });
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      units: row.establishments.length,
      activeUnits: row.establishments.filter(unit => unit.status === 'active').length,
      members: row._count.members,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async detail(id: string, period?: { from?: string; to?: string }): Promise<OrganizationDetailDto> {
    const row = await this.prisma.organization.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        createdAt: true,
        establishments: { orderBy: { name: 'asc' }, select: { id: true, name: true, status: true, city: true } },
        members: { orderBy: { createdAt: 'asc' }, select: { role: true, user: { select: { id: true, name: true, email: true, role: true } } } },
      },
    });
    if (!row) throw notFound('Organização não encontrada.');
    return {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      units: row.establishments.length,
      activeUnits: row.establishments.filter(unit => unit.status === 'active').length,
      establishments: row.establishments,
      members: row.members.map(member => ({ userId: member.user.id, name: member.user.name, email: member.user.email, userRole: member.user.role, role: member.role })),
      report: await this.report(id, period),
    };
  }

  /** Relatório consolidado da rede: pedidos pagos, GMV e ticket médio por unidade; total = soma das unidades. */
  async report(id: string, period: { from?: string; to?: string } = {}, now = new Date()): Promise<OrganizationReportDto> {
    const organization = await this.prisma.organization.findUnique({ where: { id }, select: { id: true, name: true, establishments: { orderBy: { name: 'asc' }, select: { id: true, name: true, status: true, plan: { select: { name: true } } } } } });
    if (!organization) throw notFound('Organização não encontrada.');
    const to = period.to ?? localDate(now, PLATFORM_TIMEZONE);
    const from = period.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * DAY_MS).toISOString().slice(0, 10);
    const start = zonedInstant(from, 0, PLATFORM_TIMEZONE);
    const endDay = zonedInstant(to, 0, PLATFORM_TIMEZONE);
    if (!start || !endDay || endDay < start) throw unprocessable('INVALID_PERIOD', 'Período inválido.');
    const end = new Date(endDay.getTime() + DAY_MS);
    const ids = organization.establishments.map(unit => unit.id);
    const grouped = ids.length
      ? await this.prisma.order.groupBy({
          by: ['establishmentId'],
          where: { establishmentId: { in: ids }, status: { in: ['paid', 'preparing', 'ready', 'delivered'] }, paidAt: { gte: start, lt: end } },
          _count: { _all: true },
          _sum: { totalCents: true },
        })
      : [];
    const units = organization.establishments.map(unit => {
      const found = grouped.find(group => group.establishmentId === unit.id);
      const orders = found?._count._all ?? 0;
      const gmvCents = found?._sum.totalCents ?? 0;
      return { id: unit.id, name: unit.name, status: unit.status, planName: unit.plan.name, orders, gmvCents, averageTicketCents: avg(gmvCents, orders) };
    });
    const orders = units.reduce((sum, unit) => sum + unit.orders, 0);
    const gmvCents = units.reduce((sum, unit) => sum + unit.gmvCents, 0);
    return { organizationId: organization.id, organizationName: organization.name, from, to, totals: { orders, gmvCents, averageTicketCents: avg(gmvCents, orders) }, units };
  }

  async rename(id: string, name: string): Promise<OrganizationDetailDto> {
    const current = await this.prisma.organization.findUnique({ where: { id }, select: { name: true } });
    if (!current) throw notFound('Organização não encontrada.');
    try {
      await this.prisma.$transaction(async tx => {
        await tx.organization.update({ where: { id }, data: { name } });
        await this.audit.record({ action: 'organization.updated', targetType: 'organization', targetId: id, summary: `Organização renomeada: ${current.name} → ${name}` }, tx);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('ORGANIZATION_EXISTS', 'Já existe uma organização com esse nome.');
      throw error;
    }
    return this.detail(id);
  }

  /** Move a unidade para esta rede: os admins da rede antiga perdem o acesso herdado e os da nova ganham. */
  async linkEstablishment(id: string, establishmentId: string, actor: { userId: string; name: string }): Promise<OrganizationDetailDto> {
    const [organization, establishment] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id }, select: { id: true, name: true } }),
      this.prisma.establishment.findUnique({ where: { id: establishmentId }, select: { id: true, name: true, organizationId: true, organization: { select: { name: true } } } }),
    ]);
    if (!organization) throw notFound('Organização não encontrada.');
    if (!establishment) throw unprocessable('INVALID_REFERENCE', 'Estabelecimento não encontrado.', [{ field: 'establishmentId', message: 'Estabelecimento inválido.' }]);
    if (establishment.organizationId === id) return this.detail(id);
    const affected = await this.prisma.$transaction(async tx => {
      await tx.establishment.update({ where: { id: establishmentId }, data: { organizationId: id } });
      const removed = await tx.establishmentMembership.findMany({ where: { establishmentId, organizationId: establishment.organizationId }, select: { userId: true } });
      await tx.establishmentMembership.deleteMany({ where: { establishmentId, organizationId: establishment.organizationId } });
      const admins = await tx.organizationMember.findMany({ where: { organizationId: id, role: 'admin' }, select: { userId: true } });
      await tx.establishmentMembership.createMany({ data: admins.map(admin => ({ userId: admin.userId, establishmentId, organizationId: id })), skipDuplicates: true });
      await this.changeLog.record(tx, establishmentId, actor, [{ field: 'organization', oldValue: establishment.organization.name, newValue: organization.name }]);
      await this.audit.record({ action: 'organization.establishment_linked', targetType: 'organization', targetId: id, summary: `${establishment.name} movido de ${establishment.organization.name} para ${organization.name}` }, tx);
      return [...removed, ...admins].map(row => row.userId);
    });
    for (const userId of new Set(affected)) this.realtime.staffAccessChanged(userId);
    this.realtime.establishmentUpdated(establishmentId);
    return this.detail(id);
  }

  async setMember(id: string, userId: string, role: OrganizationRole): Promise<OrganizationDetailDto> {
    const [organization, user] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id }, select: { id: true, name: true, establishments: { select: { id: true } } } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, deletedAt: true } }),
    ]);
    if (!organization) throw notFound('Organização não encontrada.');
    if (!user || user.deletedAt) throw unprocessable('INVALID_REFERENCE', 'Usuário não encontrado.', [{ field: 'userId', message: 'Usuário inválido.' }]);
    if (!STAFF_ROLES.includes(user.role)) throw unprocessable('ROLE_NOT_ALLOWED', 'Só gestores e atendentes podem ter papel em uma organização.');
    if (role === 'admin' && user.role !== 'manager') throw unprocessable('ROLE_NOT_ALLOWED', 'Só gestores podem administrar a rede inteira.');
    await this.prisma.$transaction(async tx => {
      await tx.organizationMember.upsert({ where: { organizationId_userId: { organizationId: id, userId } }, create: { organizationId: id, userId, role }, update: { role } });
      await this.syncMemberships(tx, id, userId, role, organization.establishments.map(unit => unit.id));
      await this.audit.record({ action: 'organization.member_set', targetType: 'organization', targetId: id, summary: `${user.name} é ${role === 'admin' ? 'administrador' : 'visualizador'} da rede ${organization.name}`, details: { userId, role } }, tx);
    });
    this.realtime.staffAccessChanged(userId);
    return this.detail(id);
  }

  async removeMember(id: string, userId: string): Promise<OrganizationDetailDto> {
    const member = await this.prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: id, userId } }, select: { user: { select: { name: true } }, organization: { select: { name: true } } } });
    if (!member) throw notFound('Membro não encontrado.');
    await this.prisma.$transaction(async tx => {
      await tx.organizationMember.delete({ where: { organizationId_userId: { organizationId: id, userId } } });
      await tx.establishmentMembership.deleteMany({ where: { userId, organizationId: id } });
      await this.audit.record({ action: 'organization.member_removed', targetType: 'organization', targetId: id, summary: `${member.user.name} saiu da rede ${member.organization.name}` }, tx);
    });
    this.realtime.staffAccessChanged(userId);
    return this.detail(id);
  }

  /** admin: vínculo com todas as unidades (marcado com a organização); viewer: remove os vínculos herdados. */
  private async syncMemberships(tx: PrismaTx, organizationId: string, userId: string, role: OrganizationRole, establishmentIds: string[]) {
    if (role === 'viewer') {
      await tx.establishmentMembership.deleteMany({ where: { userId, organizationId } });
      return;
    }
    await tx.establishmentMembership.createMany({ data: establishmentIds.map(establishmentId => ({ userId, establishmentId, organizationId })), skipDuplicates: true });
  }

  // ─── Painel do gestor ─────────────────────────────────────────────────────

  async mine(userId: string): Promise<{ id: string; name: string; role: OrganizationRole }[]> {
    const rows = await this.prisma.organizationMember.findMany({ where: { userId }, select: { role: true, organization: { select: { id: true, name: true } } }, orderBy: { organization: { name: 'asc' } } });
    return rows.map(row => ({ id: row.organization.id, name: row.organization.name, role: row.role }));
  }

  async reportForMember(userId: string, organizationId: string, period: { from?: string; to?: string }): Promise<OrganizationReportDto> {
    const member = await this.prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { role: true } });
    if (!member) throw forbidden('NOT_ORGANIZATION_MEMBER', 'Você não faz parte desta organização.');
    return this.report(organizationId, period);
  }
}
