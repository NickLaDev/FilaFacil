import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  INTEGRATION_OFFLINE_AFTER_MS,
  type IncidentDto,
  type IntegrationCreatedDto,
  type IntegrationDto,
  type IntegrationKind,
  type MonitoringOverviewDto,
  type Page,
} from '@filafacil/shared';
import { sha256Hex } from '../../common/crypto/hashing.js';
import { conflict, notFound, unauthorized, unprocessable } from '../../common/http/app-error.js';
import { pageArgs, toPage, type PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const MONITOR_INTERVAL_MS = 10_000;

const INTEGRATION_INCLUDE = { establishment: { select: { name: true } } } satisfies Prisma.IntegrationInclude;
type IntegrationRow = Prisma.IntegrationGetPayload<{ include: typeof INTEGRATION_INCLUDE }>;
const INCIDENT_INCLUDE = { integration: { select: { name: true, kind: true } }, establishment: { select: { name: true } } } satisfies Prisma.IncidentInclude;
type IncidentRow = Prisma.IncidentGetPayload<{ include: typeof INCIDENT_INCLUDE }>;

const toIntegrationDto = (row: IntegrationRow): IntegrationDto => ({
  id: row.id,
  establishmentId: row.establishmentId,
  establishmentName: row.establishment.name,
  name: row.name,
  kind: row.kind,
  status: row.status,
  lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

const toIncidentDto = (row: IncidentRow, now: Date): IncidentDto => ({
  id: row.id,
  integrationId: row.integrationId,
  integrationName: row.integration.name,
  integrationKind: row.integration.kind,
  establishmentId: row.establishmentId,
  establishmentName: row.establishment.name,
  cause: row.cause as IncidentDto['cause'],
  message: row.message,
  startedAt: row.startedAt.toISOString(),
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
  durationSeconds: Math.max(0, Math.round(((row.resolvedAt ?? now).getTime() - row.startedAt.getTime()) / 1000)),
});

export interface IncidentsQuery extends PageQueryDto {
  establishmentId?: string;
  active?: boolean;
}

/**
 * Integrações e incidentes (ficha 33). Cada integração (ex.: PDV) manda heartbeat com a chave própria. Sem sinal por
 * 30 s (monitor a cada 10 s: detecção em até ~40 s, dentro de 1 minuto) ou com falha informada, abre UM incidente —
 * visível na hora no painel da plataforma, com a contagem de estabelecimentos impactados. O histórico é de auditoria:
 * nunca é apagado nem reescrito (trigger no banco); o incidente só é encerrado quando a integração volta.
 */
@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return; // os testes chamam `checkOffline` com relógio injetado
    this.timer = setInterval(() => void this.checkOffline().catch(error => this.logger.warn(`Monitor de integrações falhou: ${String(error)}`)), MONITOR_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ─── Painel da plataforma ─────────────────────────────────────────────────

  async overview(now = new Date()): Promise<MonitoringOverviewDto> {
    const [integrations, incidents] = await Promise.all([
      this.prisma.integration.findMany({ include: INTEGRATION_INCLUDE, orderBy: [{ establishment: { name: 'asc' } }, { name: 'asc' }] }),
      this.prisma.incident.findMany({ where: { resolvedAt: null }, include: INCIDENT_INCLUDE, orderBy: { startedAt: 'asc' } }),
    ]);
    return {
      integrations: integrations.map(toIntegrationDto),
      activeIncidents: incidents.map(row => toIncidentDto(row, now)),
      impactedEstablishments: new Set(incidents.map(row => row.establishmentId)).size,
      checkedAt: now.toISOString(),
    };
  }

  async history(query: IncidentsQuery, now = new Date()): Promise<Page<IncidentDto>> {
    const where: Prisma.IncidentWhereInput = {
      ...(query.establishmentId && { establishmentId: query.establishmentId }),
      ...(query.active !== undefined && { resolvedAt: query.active ? null : { not: null } }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.incident.findMany({ where, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], ...pageArgs(query), include: INCIDENT_INCLUDE }),
      this.prisma.incident.count({ where }),
    ]);
    return toPage(rows.map(row => toIncidentDto(row, now)), total, query);
  }

  async createIntegration(dto: { establishmentId: string; name: string; kind: IntegrationKind }): Promise<IntegrationCreatedDto> {
    const establishment = await this.prisma.establishment.findUnique({ where: { id: dto.establishmentId }, select: { id: true } });
    if (!establishment) throw unprocessable('INVALID_REFERENCE', 'Estabelecimento não encontrado.', [{ field: 'establishmentId', message: 'Estabelecimento inválido.' }]);
    const deviceKey = `ik_${randomBytes(24).toString('base64url')}`;
    try {
      const row = await this.prisma.integration.create({ data: { establishmentId: dto.establishmentId, name: dto.name, kind: dto.kind, keyHash: sha256Hex(deviceKey) }, include: INTEGRATION_INCLUDE });
      this.realtime.monitoringUpdated();
      return { ...toIntegrationDto(row), deviceKey };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('INTEGRATION_NAME_TAKEN', 'Já existe uma integração com esse nome neste estabelecimento.');
      throw error;
    }
  }

  /** Troca a chave do dispositivo (a anterior deixa de valer na hora). Mostrada uma única vez. */
  async rotateKey(id: string): Promise<IntegrationCreatedDto> {
    const deviceKey = `ik_${randomBytes(24).toString('base64url')}`;
    const result = await this.prisma.integration.updateMany({ where: { id }, data: { keyHash: sha256Hex(deviceKey) } });
    if (result.count === 0) throw notFound('Integração não encontrada.');
    const row = await this.prisma.integration.findUniqueOrThrow({ where: { id }, include: INTEGRATION_INCLUDE });
    return { ...toIntegrationDto(row), deviceKey };
  }

  /** Só integrações sem histórico de incidentes podem ser removidas (o histórico é de auditoria). */
  async removeIntegration(id: string): Promise<void> {
    const found = await this.prisma.integration.findUnique({ where: { id }, select: { id: true, _count: { select: { incidents: true } } } });
    if (!found) throw notFound('Integração não encontrada.');
    if (found._count.incidents > 0) throw conflict('INTEGRATION_HAS_HISTORY', 'Esta integração tem histórico de incidentes, que é mantido para auditoria.');
    await this.prisma.integration.delete({ where: { id } });
    this.realtime.monitoringUpdated();
  }

  // ─── Dispositivo ──────────────────────────────────────────────────────────

  /** Heartbeat com a chave da integração (sem sessão). `error` informa falha na hora, sem esperar o prazo. */
  async heartbeat(deviceKey: string | undefined, report: { status?: 'ok' | 'error'; message?: string }, now = new Date()): Promise<void> {
    if (!deviceKey) throw unauthorized('INTEGRATION_KEY_INVALID', 'Chave da integração inválida.');
    const integration = await this.prisma.integration.findFirst({ where: { keyHash: sha256Hex(deviceKey) }, select: { id: true, establishmentId: true, name: true } });
    if (!integration) throw unauthorized('INTEGRATION_KEY_INVALID', 'Chave da integração inválida.');

    if (report.status === 'error') {
      await this.prisma.integration.update({ where: { id: integration.id }, data: { status: 'offline', lastSeenAt: now } });
      await this.openIncident(integration, 'reported', (report.message ?? 'A integração informou uma falha.').slice(0, 200), now);
      return;
    }
    const before = await this.prisma.integration.findUniqueOrThrow({ where: { id: integration.id }, select: { status: true } });
    await this.prisma.integration.update({ where: { id: integration.id }, data: { status: 'online', lastSeenAt: now } });
    const { count } = await this.prisma.incident.updateMany({ where: { integrationId: integration.id, resolvedAt: null }, data: { resolvedAt: now } });
    if (count > 0 || before.status !== 'online') this.realtime.monitoringUpdated();
  }

  /** Varre integrações online sem sinal dentro do prazo e abre o incidente (um por integração). Devolve quantos abriu. */
  async checkOffline(now = new Date()): Promise<number> {
    const limit = new Date(now.getTime() - INTEGRATION_OFFLINE_AFTER_MS);
    const silent = await this.prisma.integration.findMany({ where: { status: 'online', lastSeenAt: { lt: limit } }, select: { id: true, establishmentId: true, name: true, lastSeenAt: true } });
    let opened = 0;
    for (const integration of silent) {
      await this.prisma.integration.updateMany({ where: { id: integration.id, status: 'online' }, data: { status: 'offline' } });
      const seconds = Math.round((now.getTime() - (integration.lastSeenAt?.getTime() ?? now.getTime())) / 1000);
      if (await this.openIncident(integration, 'heartbeat_timeout', `Sem sinal da integração há ${seconds} s.`, now)) opened++;
    }
    return opened;
  }

  /** Um incidente aberto por integração (índice parcial). Devolve true quando abriu agora. */
  private async openIncident(integration: { id: string; establishmentId: string }, cause: 'heartbeat_timeout' | 'reported', message: string, now: Date): Promise<boolean> {
    try {
      await this.prisma.incident.create({ data: { integrationId: integration.id, establishmentId: integration.establishmentId, cause, message, startedAt: now } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
    this.realtime.monitoringUpdated();
    return true;
  }
}
