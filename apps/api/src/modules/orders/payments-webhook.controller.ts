import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { SkipCsrf } from '../../common/security/csrf.guard.js';
import { Public } from '../auth/auth.decorators.js';
import { OrderPaymentsService } from './order-payments.service.js';

@ApiTags('Pagamentos')
@Controller('payments')
export class PaymentsWebhookController {
  constructor(private readonly payments: OrderPaymentsService) {}

  /**
   * Chamado pelo Mercado Pago, sem sessão nem header anti-CSRF: a autenticação é a assinatura
   * (`x-signature`) e o estado do pagamento é sempre reconsultado na API do gateway.
   */
  @Public()
  @SkipCsrf()
  @Post('webhook')
  @HttpCode(200)
  // Todas as notificações do Mercado Pago saem de poucos IPs: o limite precisa tolerar rajadas legítimas.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiExcludeEndpoint()
  async webhook(
    @Req() request: Request,
    @Headers('x-signature') signature: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
  ): Promise<{ received: true }> {
    const body = request.body as { type?: unknown; data?: { id?: unknown } } | undefined;
    const type = request.query.type ?? body?.type;
    // Só notificações de pagamento interessam; as demais são confirmadas e ignoradas.
    if (type !== undefined && type !== 'payment') return { received: true };
    const queryId = request.query['data.id'];
    const rawId = typeof queryId === 'string' ? queryId : body?.data?.id;
    const dataId = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : undefined;
    await this.payments.handleWebhook({ dataId, signature, requestId });
    return { received: true };
  }
}
