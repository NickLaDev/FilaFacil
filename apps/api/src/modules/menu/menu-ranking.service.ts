import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { MenuRankingDto } from '@filafacil/shared';
import { AppConfig } from '../../config/app-config.js';
import { lockResource } from '../../database/advisory-lock.js';
import { notFound } from '../../common/http/app-error.js';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const RANKING_WINDOW_DAYS = 30;
export const RANKING_TOP = 3;
const RECALC_EVERY_MS = 7 * DAY_MS;
/** Confere a cada hora se a semana já venceu (sobrevive a reinício: a última execução fica no banco). */
const CHECK_EVERY_MS = 60 * 60 * 1000;
const RUN_ROW_ID = 1;

/**
 * Ficha 46: itens mais pedidos por estabelecimento = maior quantidade vendida em pedidos pagos nos últimos
 * 30 dias. O resultado é gravado (`menu_item_rankings`) e recalculado automaticamente toda semana por um
 * temporizador leve do processo, protegido por lock no banco para instâncias simultâneas.
 */
@Injectable()
export class MenuRankingService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MenuRankingService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly realtime: RealtimeService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.env.NODE_ENV === 'test') return; // nos testes o recálculo é chamado explicitamente
    void this.recalculateIfDue();
    this.timer = setInterval(() => void this.recalculateIfDue(), CHECK_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Recalcula todos os estabelecimentos se a última execução tem 7 dias ou mais (ou nunca houve). */
  async recalculateIfDue(now = new Date()): Promise<boolean> {
    try {
      const ran = await this.prisma.$transaction(async tx => {
        await lockResource(tx, 'menu-ranking:run');
        const last = await tx.rankingRun.findUnique({ where: { id: RUN_ROW_ID } });
        if (last && now.getTime() - last.ranAt.getTime() < RECALC_EVERY_MS) return false;
        await this.compute(tx, now);
        await tx.rankingRun.upsert({ where: { id: RUN_ROW_ID }, create: { id: RUN_ROW_ID, ranAt: now }, update: { ranAt: now } });
        return true;
      });
      if (ran) this.logger.log('Ranking de itens mais pedidos recalculado.');
      return ran;
    } catch (error) {
      this.logger.error(`Falha ao recalcular o ranking: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
      return false;
    }
  }

  /** Recalcula um estabelecimento (ou todos) agora, sem mexer no calendário semanal. */
  async recalculate(establishmentId?: string, now = new Date()) {
    await this.prisma.$transaction(async tx => {
      await lockResource(tx, 'menu-ranking:run');
      await this.compute(tx, now, establishmentId);
    });
    if (establishmentId) this.realtime.menuUpdated(establishmentId);
  }

  private async compute(tx: PrismaTx, now: Date, establishmentId?: string) {
    const since = new Date(now.getTime() - RANKING_WINDOW_DAYS * DAY_MS);
    const onlyThisOne = establishmentId ? Prisma.sql`AND o.establishment_id = ${establishmentId}::uuid` : Prisma.empty;
    // Venda = item de pedido cujo pagamento foi aprovado na janela; pedido cancelado/estornado não conta.
    const rows = await tx.$queryRaw<{ establishment_id: string; menu_item_id: string; quantity: number; position: number }[]>`
      SELECT establishment_id, menu_item_id, quantity, position::int FROM (
        SELECT o.establishment_id, oi.menu_item_id, SUM(oi.quantity)::int AS quantity,
               ROW_NUMBER() OVER (PARTITION BY o.establishment_id ORDER BY SUM(oi.quantity) DESC, MIN(oi.name) ASC) AS position
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN menu_items m ON m.id = oi.menu_item_id AND m.deleted_at IS NULL
        WHERE o.status IN ('paid', 'preparing', 'ready', 'delivered')
          AND EXISTS (
            SELECT 1 FROM payments p
            WHERE p.order_id = o.id AND p.status = 'approved' AND p.approved_at >= ${since} AND p.approved_at <= ${now}
          )
          ${onlyThisOne}
        GROUP BY o.establishment_id, oi.menu_item_id
      ) ranked
      WHERE position <= ${RANKING_TOP}`;
    await tx.menuItemRanking.deleteMany({ where: establishmentId ? { establishmentId } : {} });
    await tx.menuItemRanking.createMany({
      data: rows.map(row => ({ menuItemId: row.menu_item_id, establishmentId: row.establishment_id, rank: row.position, quantity: row.quantity, calculatedAt: now })),
    });
  }

  /** Ranking gravado de um estabelecimento (visão do gestor). */
  async get(establishmentId: string): Promise<MenuRankingDto> {
    const [rows, run] = await Promise.all([
      this.prisma.menuItemRanking.findMany({
        where: { establishmentId },
        orderBy: { rank: 'asc' },
        select: { menuItemId: true, rank: true, quantity: true, calculatedAt: true, menuItem: { select: { name: true, highlighted: true } } },
      }),
      this.prisma.rankingRun.findUnique({ where: { id: RUN_ROW_ID } }),
    ]);
    const calculatedAt = rows[0]?.calculatedAt ?? run?.ranAt ?? null;
    return {
      calculatedAt: calculatedAt?.toISOString() ?? null,
      items: rows.map(row => ({ menuItemId: row.menuItemId, name: row.menuItem.name, quantity: row.quantity, rank: row.rank, highlighted: row.menuItem.highlighted })),
    };
  }

  /** Destaque manual do gestor; persiste até ser desmarcado. */
  async setHighlighted(establishmentId: string, itemId: string, highlighted: boolean) {
    const updated = await this.prisma.menuItem.updateMany({ where: { id: itemId, establishmentId, deletedAt: null }, data: { highlighted } });
    if (updated.count === 0) throw notFound('Item não encontrado neste cardápio.');
    this.realtime.menuUpdated(establishmentId);
  }
}
