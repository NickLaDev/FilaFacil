import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { BRAND_NAME } from '../../common/brand.js';
import { maskEmail, maskPhone } from '../../common/masking.js';
import { AppConfig } from '../../config/app-config.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { deliveryErrorCode } from '../notifications/delivery-error.js';
import { EmailSender, SmsSender, type MessageSender } from '../notifications/message-senders.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const STUCK_AFTER_MS = 2 * 60 * 1000;

type Channel = 'in_app' | 'email' | 'sms';

/**
 * Aviso de pedido pronto (ficha 05): in-app (evento em tempo real) e e-mail (conta com e-mail verificado);
 * SMS só com ORDER_READY_SMS=true. Dedupe por (pedido, canal): a linha é reservada ANTES do envio (índice único),
 * então nunca há dois envios. Falha do provedor é registrada como `failed` com código tipado — nunca vira sucesso.
 */
@Injectable()
export class ReadyNotifierService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReadyNotifierService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly config: AppConfig,
    private readonly email: EmailSender,
    private readonly sms: SmsSender,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return; // os testes chamam `recoverStuck` com relógio injetado
    this.timer = setInterval(() => void this.recoverStuck().catch(error => this.logger.warn(`Recuperação de avisos falhou: ${String(error)}`)), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Linha reservada (`in_flight`) cujo envio nunca terminou (processo caiu): vira `failed/interrupted` para ficar
   * visível à equipe. Não reenvia: não há como saber se o provedor chegou a enviar (evita mensagem duplicada).
   */
  async recoverStuck(now = new Date()): Promise<number> {
    const { count } = await this.prisma.orderNotification.updateMany({
      where: { errorCode: 'in_flight', createdAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
      data: { status: 'failed', errorCode: 'interrupted' },
    });
    if (count > 0) this.logger.warn(`${count} aviso(s) de pedido pronto ficaram sem conclusão e foram marcados como interrompidos.`);
    return count;
  }

  async notifyReady(order: { id: string; userId: string; establishmentId: string }): Promise<void> {
    if (await this.claim(order.id, 'in_app', 'realtime', null)) {
      this.realtime.orderReady(order.userId, order.establishmentId, order.id);
      await this.finish(order.id, 'in_app', 'sent');
    }
    const info = await this.prisma.order.findUnique({
      where: { id: order.id },
      select: { number: true, pickupCode: true, establishment: { select: { name: true, pickupPoint: true } }, user: { select: { name: true, email: true, emailVerifiedAt: true, phone: true, phoneVerifiedAt: true } } },
    });
    if (!info) return;
    const first = info.user.name.split(' ')[0];
    const message = `${BRAND_NAME}: ${first}, seu pedido #${info.number} em ${info.establishment.name} está pronto! Retire em ${info.establishment.pickupPoint} com o código ${info.pickupCode}.`;
    await this.send(order.id, 'email', this.email, info.user.emailVerifiedAt ? info.user.email : null, info.user.email ? maskEmail(info.user.email) : null, message, `Seu pedido #${info.number} está pronto`);
    if (this.config.env.ORDER_READY_SMS) {
      await this.send(order.id, 'sms', this.sms, info.user.phoneVerifiedAt ? info.user.phone : null, info.user.phone ? maskPhone(info.user.phone) : null, message);
    }
  }

  private async send(orderId: string, channel: Channel, sender: MessageSender, destination: string | null, masked: string | null, message: string, subject?: string) {
    if (!destination) {
      if (await this.claim(orderId, channel, sender.provider, masked)) await this.finish(orderId, channel, 'skipped', 'no_verified_contact');
      return;
    }
    if (!(await this.claim(orderId, channel, sender.provider, masked))) return; // já enviado/reservado: sem duplicar
    if (!sender.available) {
      // Provedor não configurado/indisponível é falha de configuração, não "ignorado": fica visível como `failed`.
      this.logger.warn(`Aviso de pedido pronto (${channel}) sem provedor disponível.`);
      return this.finish(orderId, channel, 'failed', 'provider_unavailable');
    }
    try {
      await sender.send(destination, masked ?? '', message, { subject });
      await this.finish(orderId, channel, 'sent');
    } catch (error) {
      const code = deliveryErrorCode(error);
      this.logger.warn(`Falha ao avisar pedido pronto (${channel}, ${masked}): ${code}`);
      await this.finish(orderId, channel, 'failed', code);
    }
  }

  /** Reserva a linha (pedido+canal). false = já existe (duplicado). */
  private async claim(orderId: string, channel: Channel, provider: string, masked: string | null): Promise<boolean> {
    try {
      await this.prisma.orderNotification.create({
        data: { orderId, channel, status: 'skipped', provider, destinationMasked: masked, errorCode: 'in_flight' },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
  }

  private finish(orderId: string, channel: Channel, status: 'sent' | 'failed' | 'skipped', errorCode: string | null = null) {
    return this.prisma.orderNotification.updateMany({ where: { orderId, kind: 'order_ready', channel }, data: { status, errorCode } });
  }
}
