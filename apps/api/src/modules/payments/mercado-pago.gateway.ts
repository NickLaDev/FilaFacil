import { Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../../config/env.js';
import {
  GatewayError,
  PaymentGateway,
  type CreateGatewayPayment,
  type GatewayPayment,
  type GatewayPaymentStatus,
  type WebhookRequest,
} from './payment-gateway.js';

const API_URL = 'https://api.mercadopago.com';
const REQUEST_TIMEOUT_MS = 15_000;

export { GatewayError };

/** Falhas de conexão em que a requisição nem chegou ao Mercado Pago. */
const CONNECT_ERRORS = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ERR_INVALID_URL']);

/** 4xx = pedido recusado antes de cobrar (exceto 408/409, que podem indicar requisição em andamento). */
const notProcessed = (status: number) => status >= 400 && status < 500 && status !== 408 && status !== 409;

interface MercadoPagoPayment {
  id: number | string;
  status: string;
  status_detail?: string;
  transaction_amount: number;
  external_reference?: string | null;
  date_of_expiration?: string | null;
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string } };
}

/** Status do Mercado Pago → status interno. `in_process`, `authorized` etc. continuam pendentes. */
export function mapMercadoPagoStatus(status: string, detail?: string): GatewayPaymentStatus {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'refused';
    case 'cancelled':
      return detail === 'expired' ? 'expired' : 'cancelled';
    case 'refunded':
    case 'charged_back':
      return 'refunded';
    default:
      return 'pending';
  }
}

/** Formato de data que a API aceita: ISO 8601 com deslocamento explícito. */
const toMercadoPagoDate = (date: Date) => date.toISOString().replace('Z', '+00:00');

/**
 * Mercado Pago (Checkout Transparente): Pix e cartão pela API de Payments. O número do cartão nunca
 * passa por aqui — o navegador troca os dados por um token direto com o Mercado Pago.
 * Documentação: https://www.mercadopago.com.br/developers/pt/reference/payments/_payments/post
 */
export class MercadoPagoGateway extends PaymentGateway {
  readonly provider = 'mercadopago';
  readonly available = true;
  private readonly logger = new Logger(MercadoPagoGateway.name);

  constructor(private readonly env: Env) {
    super();
  }

  private async call<T>(method: string, path: string, options: { body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.env.MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          ...(options.idempotencyKey ? { 'X-Idempotency-Key': options.idempotencyKey } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Timeout ou conexão perdida no meio da requisição: pode ter sido processada. Só é "não processada"
      // quando a conexão nem foi estabelecida.
      const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
      throw new GatewayError(
        `Falha de rede com o Mercado Pago: ${error instanceof Error ? error.message : String(error)}`,
        null,
        cause?.code && CONNECT_ERRORS.has(cause.code) ? 'not_processed' : 'unknown',
      );
    }
    if (!response.ok) {
      // O corpo pode conter detalhes úteis, mas nunca dados do cartão (só o token chega aqui).
      const detail = await response.text().catch(() => '');
      this.logger.warn(`${method} ${path} → ${response.status} ${detail.slice(0, 300)}`);
      throw new GatewayError(`Mercado Pago respondeu ${response.status}`, response.status, notProcessed(response.status) ? 'not_processed' : 'unknown');
    }
    return (await response.json()) as T;
  }

  private toGatewayPayment(payment: MercadoPagoPayment): GatewayPayment {
    const transaction = payment.point_of_interaction?.transaction_data;
    return {
      id: String(payment.id),
      status: mapMercadoPagoStatus(payment.status, payment.status_detail),
      statusDetail: payment.status_detail ?? null,
      amountCents: Math.round(payment.transaction_amount * 100),
      externalReference: payment.external_reference ?? null,
      pix: transaction?.qr_code
        ? {
            copyPaste: transaction.qr_code,
            qrBase64: transaction.qr_code_base64 ?? null,
            expiresAt: payment.date_of_expiration ? new Date(payment.date_of_expiration) : null,
          }
        : null,
    };
  }

  async createPayment(input: CreateGatewayPayment): Promise<GatewayPayment> {
    const isPix = input.method === 'pix';
    const body = {
      transaction_amount: input.amountCents / 100,
      description: input.description,
      external_reference: input.reference,
      installments: 1,
      payment_method_id: isPix ? 'pix' : input.paymentMethodId,
      payer: { email: input.payerEmail },
      ...(isPix ? { date_of_expiration: toMercadoPagoDate(input.expiresAt) } : { token: input.cardToken }),
      ...(this.env.PAYMENT_WEBHOOK_URL ? { notification_url: this.env.PAYMENT_WEBHOOK_URL } : {}),
    };
    return this.toGatewayPayment(await this.call<MercadoPagoPayment>('POST', '/v1/payments', { body, idempotencyKey: input.idempotencyKey }));
  }

  async getPayment(providerPaymentId: string): Promise<GatewayPayment> {
    return this.toGatewayPayment(await this.call<MercadoPagoPayment>('GET', `/v1/payments/${encodeURIComponent(providerPaymentId)}`));
  }

  /**
   * Busca documentada em GET /v1/payments/search (filtro `external_reference`). Como a chave de idempotência
   * é estável, existe no máximo uma cobrança por referência; se houver mais, vale a aprovada, depois a pendente.
   */
  async findByReference(reference: string): Promise<GatewayPayment | null> {
    const query = new URLSearchParams({ external_reference: reference, sort: 'date_created', criteria: 'desc', limit: '10' });
    const { results } = await this.call<{ results?: MercadoPagoPayment[] }>('GET', `/v1/payments/search?${query.toString()}`);
    const rank = (payment: MercadoPagoPayment) => ({ approved: 0, pending: 1 })[mapMercadoPagoStatus(payment.status, payment.status_detail) as string] ?? 2;
    const mine = (results ?? []).filter(payment => payment.external_reference === reference).sort((a, b) => rank(a) - rank(b));
    return mine[0] ? this.toGatewayPayment(mine[0]) : null;
  }

  async cancelPayment(providerPaymentId: string): Promise<void> {
    await this.call('PUT', `/v1/payments/${encodeURIComponent(providerPaymentId)}`, { body: { status: 'cancelled' } });
  }

  async refundPayment(providerPaymentId: string, idempotencyKey: string): Promise<void> {
    await this.call('POST', `/v1/payments/${encodeURIComponent(providerPaymentId)}/refunds`, { body: {}, idempotencyKey });
  }

  /**
   * Assinatura do webhook: `x-signature: ts=…,v1=…`, HMAC-SHA256 do manifesto
   * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` com o segredo do painel.
   */
  verifyWebhook({ dataId, signature, requestId }: WebhookRequest): boolean {
    const secret = this.env.MP_WEBHOOK_SECRET;
    if (!secret || !signature || !dataId) return false;
    const parts = new Map(signature.split(',').map(part => part.trim().split('=', 2) as [string, string]));
    const ts = parts.get('ts');
    const v1 = parts.get('v1');
    if (!ts || !v1) return false;
    const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
    const manifest = `id:${id};${requestId ? `request-id:${requestId};` : ''}ts:${ts};`;
    const expected = createHmac('sha256', secret).update(manifest).digest('hex');
    const received = Buffer.from(v1, 'utf8');
    const wanted = Buffer.from(expected, 'utf8');
    return received.length === wanted.length && timingSafeEqual(received, wanted);
  }
}
