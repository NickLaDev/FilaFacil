import {
  GatewayError,
  PaymentGateway,
  type CreateGatewayPayment,
  type GatewayPayment,
  type GatewayPaymentStatus,
  type WebhookRequest,
} from '../../src/modules/payments/payment-gateway.js';

export const VALID_SIGNATURE = 'valid-test-signature';

/** Como a próxima chamada a `createPayment` falha (cada falha vale uma única vez). */
export type CreateFailure =
  /** O gateway recusa antes de qualquer cobrança (ex.: credencial inválida). */
  | 'not_processed'
  /** A requisição se perde antes de chegar: nada foi cobrado, mas o cliente não sabe. */
  | 'timeout_before_charge'
  /** O gateway cobra e a resposta se perde (timeout): o caso perigoso. */
  | 'timeout_after_charge';

/**
 * Dublê do gateway para os testes: guarda o que o "provedor" diria de cada pagamento. O servidor só
 * muda um pagamento quando consulta este estado (como faria com a API real). Imita também a regra do
 * Mercado Pago de que a mesma chave de idempotência devolve a cobrança já criada — e, para provar que
 * o servidor nunca repete uma chave com corpo diferente, recusa esse caso.
 */
export class FakePaymentGateway extends PaymentGateway {
  readonly provider = 'fake';
  available = true;
  /** Resultado imediato de pagamentos com cartão. */
  cardResult: GatewayPaymentStatus = 'approved';
  readonly payments = new Map<string, GatewayPayment>();
  readonly created: CreateGatewayPayment[] = [];
  readonly cancelled: string[] = [];
  readonly refunded: string[] = [];
  /** Quantas cobranças REAIS existem (idempotência já descontada): é o que o cliente teria pago. */
  charges = 0;
  createFailure: CreateFailure | null = null;
  /** A próxima busca por referência falha (provedor indisponível). */
  searchFails = false;
  /** O estorno é processado e a resposta se perde (timeout). */
  refundTimesOutAfterRefunding = false;
  /** getPayment falha enquanto verdadeiro. */
  getPaymentFails = false;
  readonly searches: string[] = [];
  private readonly byKey = new Map<string, { body: string; payment: GatewayPayment }>();
  private sequence = 0;

  private static body(input: CreateGatewayPayment) {
    return JSON.stringify([input.reference, input.amountCents, input.method, input.payerEmail, input.cardToken, input.paymentMethodId, input.expiresAt.toISOString()]);
  }

  async createPayment(input: CreateGatewayPayment): Promise<GatewayPayment> {
    this.created.push(input);
    const body = FakePaymentGateway.body(input);
    const repeated = this.byKey.get(input.idempotencyKey);
    if (repeated) {
      if (repeated.body !== body) throw new GatewayError('Idempotency key already used', 409, 'unknown');
      return { ...repeated.payment };
    }
    const failure = this.createFailure;
    this.createFailure = null;
    if (failure === 'not_processed') throw new GatewayError('credencial inválida', 401, 'not_processed');
    if (failure === 'timeout_before_charge') throw new GatewayError('timeout', null, 'unknown');

    const isPix = input.method === 'pix';
    const payment: GatewayPayment = {
      id: `fake-${++this.sequence}`,
      status: isPix ? 'pending' : this.cardResult,
      statusDetail: !isPix && this.cardResult === 'refused' ? 'cc_rejected_insufficient_amount' : null,
      amountCents: input.amountCents,
      externalReference: input.reference,
      pix: isPix ? { copyPaste: `000201-pix-${this.sequence}`, qrBase64: 'cXI=', expiresAt: input.expiresAt } : null,
    };
    this.charges++;
    this.payments.set(payment.id, payment);
    this.byKey.set(input.idempotencyKey, { body, payment });
    if (failure === 'timeout_after_charge') throw new GatewayError('timeout', null, 'unknown');
    return { ...payment };
  }

  async getPayment(id: string): Promise<GatewayPayment> {
    if (this.getPaymentFails) throw new GatewayError('indisponível', 503, 'unknown');
    const payment = this.payments.get(id);
    if (!payment) throw new Error(`pagamento desconhecido: ${id}`);
    return { ...payment };
  }

  async findByReference(reference: string): Promise<GatewayPayment | null> {
    this.searches.push(reference);
    if (this.searchFails) throw new GatewayError('indisponível', 503, 'unknown');
    const found = [...this.payments.values()].find(payment => payment.externalReference === reference);
    return found ? { ...found } : null;
  }

  async cancelPayment(id: string): Promise<void> {
    const payment = this.payments.get(id);
    if (!payment) throw new Error(`pagamento desconhecido: ${id}`);
    if (payment.status === 'approved') throw new GatewayError('já aprovado', 400, 'not_processed');
    this.cancelled.push(id);
    this.set(id, { status: 'cancelled' });
  }

  async refundPayment(id: string): Promise<void> {
    const payment = this.payments.get(id);
    if (payment?.status === 'refunded') throw new GatewayError('payment already refunded', 400, 'not_processed');
    this.refunded.push(id);
    this.set(id, { status: 'refunded' });
    if (this.refundTimesOutAfterRefunding) {
      this.refundTimesOutAfterRefunding = false;
      throw new GatewayError('timeout', null, 'unknown');
    }
  }

  verifyWebhook({ signature }: WebhookRequest) {
    return signature === VALID_SIGNATURE;
  }

  /** O que o "provedor" passa a dizer sobre o pagamento (ex.: cliente pagou o Pix). */
  set(id: string, changes: Partial<GatewayPayment>) {
    const payment = this.payments.get(id);
    if (!payment) throw new Error(`pagamento desconhecido: ${id}`);
    const next = { ...payment, ...changes };
    this.payments.set(id, next);
    for (const entry of this.byKey.values()) if (entry.payment.id === id) entry.payment = next;
  }

  reset() {
    this.available = true;
    this.cardResult = 'approved';
    this.payments.clear();
    this.byKey.clear();
    this.created.length = 0;
    this.cancelled.length = 0;
    this.refunded.length = 0;
    this.searches.length = 0;
    this.charges = 0;
    this.createFailure = null;
    this.searchFails = false;
    this.refundTimesOutAfterRefunding = false;
    this.getPaymentFails = false;
    this.sequence = 0;
  }

  get lastId() {
    return `fake-${this.sequence}`;
  }
}
