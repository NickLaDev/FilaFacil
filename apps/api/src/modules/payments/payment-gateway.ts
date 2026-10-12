import type { PaymentMethod } from '@filafacil/shared';

/** Situação do pagamento segundo o gateway (o servidor só confia nisto, nunca no cliente). */
export type GatewayPaymentStatus = 'pending' | 'approved' | 'refused' | 'expired' | 'cancelled' | 'refunded';

export interface GatewayPayment {
  id: string;
  status: GatewayPaymentStatus;
  /** Motivo informado pelo gateway quando recusado (não é exibido ao cliente em detalhe). */
  statusDetail: string | null;
  amountCents: number;
  /** Nossa referência (id do Payment), devolvida pelo gateway. */
  externalReference: string | null;
  pix: { copyPaste: string; qrBase64: string | null; expiresAt: Date | null } | null;
}

/**
 * Falha ao falar com o gateway. `not_processed`: o pedido foi recusado antes de qualquer cobrança
 * (credencial/dados inválidos, sem conexão); `unknown`: pode ter sido processado (timeout, 5xx, conexão perdida).
 */
export type GatewayOutcome = 'not_processed' | 'unknown';

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly outcome: GatewayOutcome = 'unknown',
  ) {
    super(message);
  }
}

export interface CreateGatewayPayment {
  /** id do Payment: vira a referência externa. */
  reference: string;
  /** Chave de idempotência estável por Payment: repetir a mesma chave nunca cobra duas vezes. */
  idempotencyKey: string;
  amountCents: number;
  description: string;
  method: PaymentMethod;
  payerEmail: string;
  /** Pix: validade do código. */
  expiresAt: Date;
  /** Cartão: token gerado no navegador e bandeira/tipo (ex.: "visa", "debelo"). */
  cardToken?: string;
  paymentMethodId?: string;
}

export interface WebhookRequest {
  /** `data.id` informado na query string. */
  dataId: string | undefined;
  signature: string | undefined;
  requestId: string | undefined;
}

/**
 * Fronteira com o provedor de pagamento. A implementação real é do Mercado Pago; sem provider
 * configurado o serviço recusa pagamentos em vez de aprová-los.
 */
export abstract class PaymentGateway {
  abstract readonly provider: string;
  abstract readonly available: boolean;
  abstract createPayment(input: CreateGatewayPayment): Promise<GatewayPayment>;
  abstract getPayment(providerPaymentId: string): Promise<GatewayPayment>;
  /**
   * Procura a cobrança pela nossa referência externa (o id do Payment). Conciliação de resultado incerto:
   * `null` = o gateway confirma que não há cobrança com essa referência.
   */
  abstract findByReference(reference: string): Promise<GatewayPayment | null>;
  abstract cancelPayment(providerPaymentId: string): Promise<void>;
  abstract refundPayment(providerPaymentId: string, idempotencyKey: string): Promise<void>;
  /** Confere a assinatura do webhook (HMAC com o segredo do provedor). */
  abstract verifyWebhook(request: WebhookRequest): boolean;
}

/** Sem provider: nada é cobrado nem aprovado. */
export class DisabledPaymentGateway extends PaymentGateway {
  readonly provider = 'none';
  readonly available = false;

  private fail(): never {
    throw new Error('Nenhum gateway de pagamento configurado.');
  }

  createPayment(): Promise<GatewayPayment> {
    return this.fail();
  }
  getPayment(): Promise<GatewayPayment> {
    return this.fail();
  }
  findByReference(): Promise<GatewayPayment | null> {
    return this.fail();
  }
  cancelPayment(): Promise<void> {
    return this.fail();
  }
  refundPayment(): Promise<void> {
    return this.fail();
  }
  verifyWebhook() {
    return false;
  }
}
