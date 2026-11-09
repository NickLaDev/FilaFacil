import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, type PrismaTx } from '../../database/prisma.service.js';
import { InboxService } from '../inbox/inbox.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { StockService } from '../stock/stock.service.js';
import { ReadyNotifierService } from './ready-notifier.service.js';

/**
 * Efeitos colaterais das transições de pedido. Os métodos `on*` rodam DENTRO da transação da transição (sob o
 * lock `order:<id>`), então valem tudo-ou-nada; os `after*` rodam depois do commit e nunca derrubam a resposta
 * (a falha fica no log; o estado do pedido já está gravado).
 */
/** Tempo máximo que a transição para `ready` espera o aviso ao cliente. */
export const READY_NOTIFY_WAIT_MS = 1500;

@Injectable()
export class OrderEffectsService {
  private readonly logger = new Logger(OrderEffectsService.name);

  constructor(
    private readonly loyalty: LoyaltyService,
    private readonly stock: StockService,
    private readonly notifier: ReadyNotifierService,
    private readonly inbox: InboxService,
    private readonly prisma: PrismaService,
  ) {}

  /** Pedido entrou em preparo: baixa de estoque (uma única vez). */
  async onPreparing(tx: PrismaTx, orderId: string): Promise<void> {
    await this.stock.consumeForOrder(tx, orderId);
  }

  /** Pedido entregue: crédito de pontos, se já estiver pago. */
  async onDelivered(tx: PrismaTx, orderId: string): Promise<void> {
    await this.loyalty.earnForOrder(tx, orderId);
  }

  /** Pedido cancelado/estornado: devolve pontos resgatados e reverte pontos ganhos. */
  async onCancelled(tx: PrismaTx, orderId: string): Promise<void> {
    await this.loyalty.revertForOrder(tx, orderId);
  }

  async afterPreparing(establishmentId: string, orderId: string): Promise<void> {
    await this.safely('alertas de estoque', async () => {
      await this.stock.syncAlerts(establishmentId);
      await this.stock.signalShortfalls(establishmentId, orderId);
    });
  }

  /** Depois do commit de `ready`: aviso in-app + e-mail. */
  async afterReady(order: { id: string; userId: string; establishmentId: string }): Promise<void> {
    // Não prende a resposta ao cozinheiro por causa de um SMTP/SMS lento: espera no máximo ReadyNotifier.WAIT_MS e o
    // envio segue em segundo plano (a linha de dedupe já está reservada e o monitor recupera o que ficar preso).
    const work = this.safely('aviso de pedido pronto', () => this.notifier.notifyReady(order));
    await Promise.race([work, new Promise<void>(resolve => setTimeout(resolve, READY_NOTIFY_WAIT_MS).unref())]);
  }

  /**
   * Pedido entregue: atualiza o saldo e pede a avaliação (ficha 48) por aviso in-app + e-mail (conta com e-mail
   * verificado). O pedido é enviado em segundo plano: a falha nunca atrasa nem derruba a entrega. Um único pedido
   * de avaliação por pedido (`dedupeKey`).
   */
  afterDelivered(order: { id: string; userId: string; establishmentId: string }): void {
    this.loyalty.notify(order.userId);
    void this.safely('pedido de avaliação', async () => {
      const info = await this.prisma.order.findUnique({ where: { id: order.id }, select: { number: true, establishment: { select: { name: true } } } });
      if (!info) return;
      await this.inbox.notifyUser(order.userId, {
        kind: 'review_request',
        title: `Como foi seu pedido em ${info.establishment.name}?`,
        body: `Avalie o pedido #${info.number} e ajude outros clientes a escolher.`,
        refId: order.id,
        dedupeKey: `review_request:${order.id}`,
        email: true,
      });
    });
  }

  private async safely(what: string, run: () => Promise<void>) {
    try {
      await run();
    } catch (error) {
      this.logger.error(`Falha em ${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
