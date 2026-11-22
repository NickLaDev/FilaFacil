import { Injectable, Logger } from '@nestjs/common';
import { auditActionLabel, type AuditAction, type AuditLogDto, type Page } from '@filafacil/shared';
import { pageArgs, toPage, type PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { currentRequest } from '../../common/request-context.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

export interface AuditEntry {
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  summary: string;
  details?: Record<string, unknown>;
  /** Autor explícito (rotinas e fluxos sem sessão); padrão = usuário da requisição atual. */
  actor?: { id: string | null; name: string; role?: string | null };
}

export interface AuditQuery extends PageQueryDto {
  actorId?: string;
  action?: string;
  q?: string;
  from?: string;
  to?: string;
}

/**
 * Auditoria das ações sensíveis (ficha 42). Registra autor (da sessão da requisição), ação, alvo, resumo, detalhes e
 * IP. Somente inserção: não há rota de edição/exclusão e o banco rejeita UPDATE/DELETE (trigger). Passe o `tx` da
 * operação para que o registro e a ação sejam gravados juntos.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, client: PrismaTx | PrismaService = this.prisma): Promise<void> {
    const request = currentRequest();
    const auth = request?.auth;
    const actor = entry.actor ?? (auth ? { id: auth.userId, name: auth.name, role: auth.role } : { id: null, name: 'Sistema', role: 'system' });
    await client.auditLog.create({
      data: {
        actorId: actor.id,
        actorName: actor.name.slice(0, 120),
        actorRole: actor.role ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        summary: entry.summary.slice(0, 300),
        details: (entry.details ?? undefined) as Prisma.InputJsonValue | undefined,
        ipAddress: request?.ip?.slice(0, 64) ?? null,
      },
    });
  }

  /** Para fluxos em que a auditoria não pode derrubar a ação já concluída (fora de transação). */
  async recordSafely(entry: AuditEntry): Promise<void> {
    try {
      await this.record(entry);
    } catch (error) {
      this.logger.error(`Falha ao registrar auditoria (${entry.action}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async list(query: AuditQuery): Promise<Page<AuditLogDto>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorId && { actorId: query.actorId }),
      ...(query.action && { action: query.action }),
      ...(query.q && { OR: [{ actorName: { contains: query.q, mode: 'insensitive' } }, { summary: { contains: query.q, mode: 'insensitive' } }] }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && { gte: new Date(`${query.from}T00:00:00-03:00`) }),
          ...(query.to && { lt: new Date(new Date(`${query.to}T00:00:00-03:00`).getTime() + 86_400_000) }),
        },
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(query) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return toPage(
      rows.map(row => ({
        id: row.id,
        actorId: row.actorId,
        actorName: row.actorName,
        actorRole: row.actorRole,
        action: row.action,
        actionLabel: auditActionLabel(row.action),
        targetType: row.targetType,
        targetId: row.targetId,
        summary: row.summary,
        details: row.details,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }
}
