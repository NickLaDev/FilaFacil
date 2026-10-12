import { Injectable } from '@nestjs/common';
import {
  isPermission,
  PERMISSIONS,
  permissionLabel,
  ROLE_LABELS,
  STAFF_ROLES,
  type AdminUserDto,
  type AdminUsersPage,
  type Page,
  type Permission,
  type PermissionAuditDto,
  type UserRole,
  type UserStatus,
} from '@filafacil/shared';
import { forbidden, notFound, unprocessable } from '../../common/http/app-error.js';
import { pageArgs, toPage } from '../../common/pagination/page-query.dto.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import type { Prisma, PermissionAuditAction } from '../../generated/prisma/client.js';
import type { AuthContext } from '../auth/auth.types.js';
import { SessionService } from '../auth/session.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { ListAuditQueryDto, ListUsersQueryDto, UpdateUserAccessDto } from './dto/admin-users.dto.js';

const USER_INCLUDE = {
  permissions: { select: { permission: true } },
  memberships: { orderBy: { createdAt: 'asc' }, select: { establishment: { select: { id: true, name: true } } } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

/** Escopo de permissão aceito por papel: o admin não consegue dar a um cliente acesso de plataforma. */
const ROLE_SCOPE: Record<UserRole, (typeof PERMISSIONS)[number]['scope']> = {
  client: 'client',
  attendant: 'establishment',
  manager: 'establishment',
  admin: 'platform',
};

const toAdminUser = (user: UserRow): AdminUserDto => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  status: user.status,
  permissions: user.permissions.map(p => p.permission).filter(isPermission),
  memberships: user.memberships.map(({ establishment }) => ({ establishmentId: establishment.id, establishmentName: establishment.name })),
  lastAccessAt: user.lastAccessAt?.toISOString() ?? null,
  createdAt: user.createdAt.toISOString(),
});

const selfLock = () =>
  forbidden('SELF_MODIFICATION_FORBIDDEN', 'Por segurança, você não pode alterar o acesso da própria conta — peça a outro administrador.');

interface AuditEntry {
  action: PermissionAuditAction;
  description: string;
  before: Prisma.InputJsonValue;
  after: Prisma.InputJsonValue;
}

/** Ficha 36: papéis, permissões, vínculos, suspensão e histórico de alterações. */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(query: ListUsersQueryDto): Promise<AdminUsersPage> {
    const search: Prisma.UserWhereInput = query.q
      ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { email: { contains: query.q, mode: 'insensitive' } }] }
      : {};
    const where: Prisma.UserWhereInput = { ...search, ...(query.role && { role: query.role }), ...(query.status && { status: query.status }) };
    const [rows, total, grouped] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, include: USER_INCLUDE, orderBy: [{ role: 'desc' }, { name: 'asc' }], ...pageArgs(query) }),
      this.prisma.user.count({ where }),
      this.prisma.user.groupBy({ by: ['role'], where: search, _count: { _all: true }, orderBy: { role: 'asc' } }),
    ]);
    const counts = { all: 0, client: 0, attendant: 0, manager: 0, admin: 0 };
    for (const group of grouped) {
      const count = (group._count as { _all: number })._all;
      counts[group.role] = count;
      counts.all += count;
    }
    return { items: rows.map(toAdminUser), page: query.page, pageSize: query.pageSize, total, counts };
  }

  async get(id: string): Promise<AdminUserDto> {
    return toAdminUser(await this.find(id));
  }

  /** Troca papel, permissões e vínculos numa transação, registrando antes/depois no histórico. */
  async updateAccess(actor: AuthContext, id: string, dto: UpdateUserAccessDto): Promise<AdminUserDto> {
    if (actor.userId === id) throw selfLock();
    const permissions = PERMISSIONS.map(p => p.key).filter(key => dto.permissions.includes(key));
    const invalid = permissions.filter(key => PERMISSIONS.find(p => p.key === key)?.scope !== ROLE_SCOPE[dto.role]);
    if (invalid.length) {
      throw unprocessable('PERMISSION_NOT_ALLOWED_FOR_ROLE', `Permissões incompatíveis com o papel ${ROLE_LABELS[dto.role]}: ${invalid.map(permissionLabel).join(', ')}.`);
    }
    const isStaff = STAFF_ROLES.includes(dto.role);
    const establishmentIds = isStaff ? (dto.establishmentIds ?? []) : [];
    if (isStaff && establishmentIds.length === 0) {
      throw unprocessable('MEMBERSHIP_REQUIRED', 'Vincule atendentes e gestores a pelo menos um estabelecimento.', [{ field: 'establishmentIds', message: 'Obrigatório.' }]);
    }
    if (establishmentIds.length) {
      const found = await this.prisma.establishment.count({ where: { id: { in: establishmentIds } } });
      if (found !== establishmentIds.length) throw unprocessable('INVALID_REFERENCE', 'Estabelecimento não encontrado.', [{ field: 'establishmentIds', message: 'Estabelecimento inválido.' }]);
    }

    const changed = await this.prisma.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { id }, include: USER_INCLUDE });
      if (!user) throw notFound('Usuário não encontrado.');
      if (user.role === 'admin' && dto.role !== 'admin') await this.assertAnotherAdmin(tx, id);

      const entries = this.diffAccess(user, dto.role, permissions, establishmentIds);
      if (!entries.length) return false;
      await tx.user.update({ where: { id }, data: { role: dto.role } });
      await tx.userPermission.deleteMany({ where: { userId: id } });
      await tx.userPermission.createMany({ data: permissions.map(permission => ({ userId: id, permission })) });
      await tx.establishmentMembership.deleteMany({ where: { userId: id, establishmentId: { notIn: establishmentIds } } });
      await tx.establishmentMembership.createMany({ data: establishmentIds.map(establishmentId => ({ userId: id, establishmentId })), skipDuplicates: true });
      await tx.permissionAuditLog.createMany({ data: entries.map(entry => ({ ...entry, targetUserId: id, actorId: actor.userId })) });
      return true;
    });
    if (changed) this.realtime.staffAccessChanged(id);
    return this.get(id);
  }

  /** Suspensão derruba todas as sessões na hora e avisa os navegadores abertos via WebSocket. */
  async setStatus(actor: AuthContext, id: string, status: UserStatus): Promise<AdminUserDto> {
    if (actor.userId === id) throw selfLock();
    const changed = await this.prisma.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { id }, select: { status: true, role: true } });
      if (!user) throw notFound('Usuário não encontrado.');
      if (user.status === status) return false;
      if (status === 'suspended' && user.role === 'admin') await this.assertAnotherAdmin(tx, id);
      await tx.user.update({ where: { id }, data: { status } });
      await tx.permissionAuditLog.create({
        data: {
          targetUserId: id,
          actorId: actor.userId,
          action: status === 'suspended' ? 'suspended' : 'reactivated',
          description: status === 'suspended' ? 'Usuário suspenso' : 'Usuário reativado',
          before: { status: user.status },
          after: { status },
        },
      });
      return true;
    });
    if (changed && status === 'suspended') await this.sessions.revokeAllForUser(id, 'suspended');
    return this.get(id);
  }

  async audit(query: ListAuditQueryDto): Promise<Page<PermissionAuditDto>> {
    const where = query.userId ? { targetUserId: query.userId } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.permissionAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
        include: { targetUser: { select: { name: true } }, actor: { select: { name: true } } },
      }),
      this.prisma.permissionAuditLog.count({ where }),
    ]);
    return toPage(
      rows.map(row => ({
        id: row.id,
        targetUserId: row.targetUserId,
        targetUserName: row.targetUser.name,
        actorName: row.actor.name,
        action: row.action,
        description: row.description,
        before: row.before,
        after: row.after,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }

  private async find(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    if (!user) throw notFound('Usuário não encontrado.');
    return user;
  }

  /** Evita que a plataforma fique sem nenhum administrador ativo. */
  private async assertAnotherAdmin(tx: PrismaTx, exceptId: string) {
    const others = await tx.user.count({ where: { role: 'admin', status: 'active', id: { not: exceptId } } });
    if (others === 0) throw unprocessable('LAST_ADMIN', 'A plataforma precisa de pelo menos um administrador ativo.');
  }

  private diffAccess(user: UserRow, role: UserRole, permissions: Permission[], establishmentIds: string[]): AuditEntry[] {
    const entries: AuditEntry[] = [];
    if (user.role !== role) {
      entries.push({
        action: 'role_changed',
        description: `Papel alterado de ${ROLE_LABELS[user.role]} para ${ROLE_LABELS[role]}`,
        before: { role: user.role },
        after: { role },
      });
    }
    const current = user.permissions.map(p => p.permission).filter(isPermission);
    const added = permissions.filter(p => !current.includes(p));
    const removed = current.filter(p => !permissions.includes(p));
    if (added.length || removed.length) {
      const parts = [
        ...(added.length ? [`Permissões concedidas: ${added.map(permissionLabel).join(', ')}`] : []),
        ...(removed.length ? [`Permissões removidas: ${removed.map(permissionLabel).join(', ')}`] : []),
      ];
      entries.push({ action: 'permissions_changed', description: parts.join(' · '), before: { permissions: current }, after: { permissions } });
    }
    const currentIds = user.memberships.map(m => m.establishment.id);
    if (currentIds.length !== establishmentIds.length || currentIds.some(estId => !establishmentIds.includes(estId))) {
      entries.push({
        action: 'memberships_changed',
        description: 'Vínculos com estabelecimentos alterados',
        before: { establishmentIds: currentIds },
        after: { establishmentIds },
      });
    }
    return entries;
  }
}
