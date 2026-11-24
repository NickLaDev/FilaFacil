import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  type IncidentDto,
  type IntegrationCreatedDto,
  type IntegrationDto,
  type IntegrationDetailDto,
  type IntegrationKind,
  type MonitoringOverviewDto,
  type Page,
} from '@filafacil/shared';
import { sha256Hex } from '../../common/crypto/hashing.js';
import { conflict, notFound, unauthorized, unprocessable } from '../../common/http/app-error.js';
import { pageArgs, toPage, type PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AppConfig } from '../../config/app-config.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { assertSafeHealthUrl, probeHealthUrl } from './health-probe.js';
import { SettingsService } from '../settings/settings.service.js';
import { AuditService } from '../audit/audit.service.js';

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
  enabled: row.enabled,
  healthUrl: row.healthUrl,
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
  private ticks = 0;
  private probing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return; // os testes chamam `checkOffline` com relógio injetado
    this.timer = setInterval(() => {
      void this.checkOffline().catch(error => this.logger.warn(`Monitor de integrações falhou: ${String(error)}`));
      // URLs de saúde (ficha 40): a cada 30 s (3 voltas do monitor), sem sobrepor uma rodada à outra.
      if (++this.ticks % 3 === 0 && !this.probing) {
        this.probing = true;
        void this.probeAll().catch(error => this.logger.warn(`Teste de integrações falhou: ${String(error)}`)).finally(() => (this.probing = false));
      }
    }, MONITOR_INTERVAL_MS);
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

  async createIntegration(dto: { establishmentId: string; name: string; kind: IntegrationKind; healthUrl?: string | null }): Promise<IntegrationCreatedDto> {
    if (dto.healthUrl) await this.safeUrl(dto.healthUrl);
    const establishment = await this.prisma.establishment.findUnique({ where: { id: dto.establishmentId }, select: { id: true } });
    if (!establishment) throw unprocessable('INVALID_REFERENCE', 'Estabelecimento não encontrado.', [{ field: 'establishmentId', message: 'Estabelecimento inválido.' }]);
    const deviceKey = `ik_${randomBytes(24).toString('base64url')}`;
    try {
      const row = await this.prisma.integration.create({ data: { establishmentId: dto.establishmentId, name: dto.name, kind: dto.kind, keyHash: sha256Hex(deviceKey), healthUrl: dto.healthUrl ?? null }, include: INTEGRATION_INCLUDE });
      this.realtime.monitoringUpdated();
      await this.audit.recordSafely({ action: 'integration.created', targetType: 'integration', targetId: row.id, summary: `Integração ${row.name} (${row.kind}) cadastrada em ${row.establishment.name}` });
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
    await this.audit.recordSafely({ action: 'integration.key_rotated', targetType: 'integration', targetId: id, summary: `Chave da integração ${row.name} trocada` });
    return { ...toIntegrationDto(row), deviceKey };
  }

  /** Só integrações sem histórico de incidentes podem ser removidas (o histórico é de auditoria). */
  async removeIntegration(id: string): Promise<void> {
    const found = await this.prisma.integration.findUnique({ where: { id }, select: { id: true, _count: { select: { incidents: true } } } });
    if (!found) throw notFound('Integração não encontrada.');
    if (found._count.incidents > 0) throw conflict('INTEGRATION_HAS_HISTORY', 'Esta integração tem histórico de incidentes, que é mantido para auditoria.');
    await this.prisma.integration.delete({ where: { id } });
    await this.audit.recordSafely({ action: 'integration.deleted', targetType: 'integration', targetId: id, summary: 'Integração removida' });
    this.realtime.monitoringUpdated();
  }

  // ─── Dispositivo ──────────────────────────────────────────────────────────

  /** Heartbeat com a chave da integração (sem sessão). `error` informa falha na hora, sem esperar o prazo. */
  async heartbeat(deviceKey: string | undefined, report: { status?: 'ok' | 'error'; message?: string }, now = new Date()): Promise<void> {
    if (!deviceKey) throw unauthorized('INTEGRATION_KEY_INVALID', 'Chave da integração inválida.');
    const integration = await this.prisma.integration.findFirst({ where: { keyHash: sha256Hex(deviceKey) }, select: { id: true, establishmentId: true, name: true, enabled: true } });
    if (!integration) throw unauthorized('INTEGRATION_KEY_INVALID', 'Chave da integração inválida.');
    // Desativada (ficha 40): o sinal é registrado, mas não muda status nem abre incidente.
    if (!integration.enabled) {
      await this.prisma.integration.update({ where: { id: integration.id }, data: { lastSeenAt: now } });
      return;
    }

    if (report.status === 'error') {
      await this.prisma.integration.update({ where: { id: integration.id }, data: { status: 'offline', lastSeenAt: now } });
      await this.prisma.integrationCheck.create({ data: { integrationId: integration.id, ok: false, error: (report.message ?? 'Falha informada pela integração').slice(0, 200), trigger: 'monitor' } });
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
    const limit = new Date(now.getTime() - (await this.settings.get<number>('integrations.offlineAfterSeconds')) * 1000);
    // Integrações com URL de saúde são testadas ativamente (probeAll, a cada 30 s): varrer por "sem sinal" com o mesmo prazo
    // de 30 s abria e fechava incidentes falsos a cada rodada.
    const silent = await this.prisma.integration.findMany({ where: { enabled: true, status: 'online', healthUrl: null, lastSeenAt: { lt: limit } }, select: { id: true, establishmentId: true, name: true, lastSeenAt: true } });
    let opened = 0;
    for (const integration of silent) {
      await this.prisma.integration.updateMany({ where: { id: integration.id, status: 'online' }, data: { status: 'offline' } });
      const seconds = Math.round((now.getTime() - (integration.lastSeenAt?.getTime() ?? now.getTime())) / 1000);
      await this.prisma.integrationCheck.create({ data: { integrationId: integration.id, ok: false, error: `Sem sinal há ${seconds} s`, trigger: 'monitor', createdAt: now } });
      if (await this.openIncident(integration, 'heartbeat_timeout', `Sem sinal da integração há ${seconds} s.`, now)) opened++;
    }
    return opened;
  }

  /** Um incidente aberto por integração (índice parcial). Devolve true quando abriu agora. */
  private async openIncident(integration: { id: string; establishmentId: string }, cause: 'heartbeat_timeout' | 'reported' | 'check_failed', message: string, now: Date): Promise<boolean> {
    try {
      await this.prisma.incident.create({ data: { integrationId: integration.id, establishmentId: integration.establishmentId, cause, message, startedAt: now } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
    this.realtime.monitoringUpdated();
    return true;
  }

  // ─── Ficha 40: ativar/desativar, URL de saúde, teste manual e histórico de falhas ────────────────

  private async safeUrl(raw: string) {
    try {
      await assertSafeHealthUrl(raw, !this.config.isProduction);
    } catch (error) {
      throw unprocessable('INVALID_HEALTH_URL', error instanceof Error ? error.message : 'URL inválida.', [{ field: 'healthUrl', message: 'URL inválida.' }]);
    }
  }

  async detail(id: string): Promise<IntegrationDetailDto> {
    const row = await this.prisma.integration.findUnique({ where: { id }, include: { ...INTEGRATION_INCLUDE, checks: { orderBy: { createdAt: 'desc' }, take: 30 } } });
    if (!row) throw notFound('Integração não encontrada.');
    return {
      ...toIntegrationDto(row),
      checks: row.checks.map(check => ({ id: check.id, ok: check.ok, latencyMs: check.latencyMs, error: check.error, trigger: check.trigger as 'manual' | 'monitor', createdAt: check.createdAt.toISOString() })),
    };
  }

  /** Desativar encerra o incidente aberto (a integração deixa de ser monitorada); reativar volta a monitorar. */
  async updateIntegration(id: string, dto: { enabled?: boolean; healthUrl?: string | null; name?: string }, now = new Date()): Promise<IntegrationDetailDto> {
    const current = await this.prisma.integration.findUnique({ where: { id }, select: { id: true, name: true, enabled: true } });
    if (!current) throw notFound('Integração não encontrada.');
    if (dto.healthUrl) await this.safeUrl(dto.healthUrl);
    try {
      await this.prisma.$transaction(async tx => {
        await tx.integration.update({
          where: { id },
          data: {
            name: dto.name,
            ...(dto.healthUrl !== undefined && { healthUrl: dto.healthUrl || null }),
            ...(dto.enabled !== undefined && { enabled: dto.enabled, ...(dto.enabled === false && { status: 'unknown' }) }),
          },
        });
        if (dto.enabled === false) await tx.incident.updateMany({ where: { integrationId: id, resolvedAt: null }, data: { resolvedAt: now } });
        await this.audit.record(
          { action: 'integration.updated', targetType: 'integration', targetId: id, summary: `Integração ${dto.name ?? current.name}: ${dto.enabled === undefined ? 'dados alterados' : dto.enabled ? 'ativada' : 'desativada'}`, details: { ...dto } },
          tx,
        );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('INTEGRATION_NAME_TAKEN', 'Já existe uma integração com esse nome neste estabelecimento.');
      throw error;
    }
    this.realtime.monitoringUpdated();
    return this.detail(id);
  }

  /**
   * Teste manual: com URL de saúde, faz a chamada agora; sem URL, confere se o último heartbeat está dentro do prazo.
   * Falha = "indisponível" + incidente na hora; sucesso = disponível e incidente encerrado. Todo teste fica no histórico.
   */
  async testIntegration(id: string, actorId: string | null, trigger: 'manual' | 'monitor' = 'manual', now = new Date()): Promise<IntegrationDetailDto> {
    const integration = await this.prisma.integration.findUnique({ where: { id }, select: { id: true, name: true, establishmentId: true, enabled: true, healthUrl: true, lastSeenAt: true, status: true } });
    if (!integration) throw notFound('Integração não encontrada.');
    let result: { ok: boolean; latencyMs: number | null; error: string | null };
    if (integration.healthUrl) result = await probeHealthUrl(integration.healthUrl, !this.config.isProduction);
    else {
      const limitMs = (await this.settings.get<number>('integrations.offlineAfterSeconds')) * 1000;
      const age = integration.lastSeenAt ? now.getTime() - integration.lastSeenAt.getTime() : null;
      result = age !== null && age < limitMs ? { ok: true, latencyMs: null, error: null } : { ok: false, latencyMs: null, error: age === null ? 'A integração nunca enviou sinal' : `Último sinal há ${Math.round(age / 1000)} s` };
    }
    await this.prisma.integrationCheck.create({ data: { integrationId: id, ok: result.ok, latencyMs: result.latencyMs, error: result.error, trigger, actorId } });
    if (integration.enabled) {
      if (result.ok) {
        await this.prisma.integration.update({ where: { id }, data: { status: 'online', ...(integration.healthUrl && { lastSeenAt: now }) } });
        await this.prisma.incident.updateMany({ where: { integrationId: id, resolvedAt: null }, data: { resolvedAt: now } });
      } else {
        await this.prisma.integration.update({ where: { id }, data: { status: 'offline' } });
        await this.openIncident(integration, 'check_failed', `Teste de conexão falhou: ${result.error ?? 'sem detalhe'}`.slice(0, 200), now);
      }
    }
    if (trigger === 'manual') {
      await this.audit.recordSafely({ action: 'integration.tested', targetType: 'integration', targetId: id, summary: `Teste manual de ${integration.name}: ${result.ok ? 'disponível' : `indisponível (${result.error})`}` });
    }
    this.realtime.monitoringUpdated();
    return this.detail(id);
  }

  /** Monitor: testa as integrações ativas que têm URL de saúde (falha abre incidente na hora). */
  async probeAll(now = new Date()): Promise<void> {
    const rows = await this.prisma.integration.findMany({ where: { enabled: true, healthUrl: { not: null } }, select: { id: true } });
    for (const row of rows) await this.testIntegration(row.id, null, 'monitor', now);
  }
}
