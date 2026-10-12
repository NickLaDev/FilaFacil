import { GatewayError, PaymentGateway, type CreateGatewayPayment, type GatewayPayment } from './payment-gateway.js';
import type { PrismaService } from '../../database/prisma.service.js';

/** Todo id de cobrança simulada começa assim: nunca se confunde com um id real do gateway. */
export const SIMULATED_ID_PREFIX = 'SIM-';

/** Cenários de cartão (vão no `cardToken`; nenhum dado de cartão é digitado ou enviado). */
export const SIMULATED_CARD_SCENARIOS = ['sim_approved', 'sim_refused', 'sim_error'] as const;

const idFor = (reference: string) => `${SIMULATED_ID_PREFIX}${reference}`;

/**
 * Gateway SIMULADO para desenvolvimento e demonstrações acadêmicas. Não fala com nenhum provedor e nenhum
 * dinheiro é movido. Só existe com PAYMENT_PROVIDER=simulated + ALLOW_SIMULATED_PAYMENTS=true fora de produção.
 *
 * O "estado do provedor" fica num ledger em memória, que é só um espelho: o PostgreSQL continua sendo a verdade.
 * Um id desconhecido (API reiniciada) é reconstruído a partir da linha `payments` já aplicada, então um Pix
 * pendente sobrevive a reinício e nunca surge uma aprovação que o banco não conheça (a aprovação só vale depois de
 * `apply()` gravá-la).
 */
export class SimulatedPaymentGateway extends PaymentGateway {
  readonly provider = 'simulated';
  readonly available = true;
  private readonly ledger = new Map<string, GatewayPayment>();

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /** Estado vigente da cobrança: ledger ou, se a API reiniciou, a linha gravada no banco. */
  private async lookup(id: string): Promise<GatewayPayment | null> {
    const known = this.ledger.get(id);
    if (known) return known;
    const row = await this.prisma.payment.findUnique({ where: { providerPaymentId: id } });
    if (!row) return null;
    const restored: GatewayPayment = {
      id,
      status: row.status,
      statusDetail: row.failureReason,
      amountCents: row.amountCents,
      externalReference: row.id,
      pix: row.method === 'pix' && row.pixCopyPaste ? { copyPaste: row.pixCopyPaste, qrBase64: row.pixQrBase64, expiresAt: row.pixExpiresAt } : null,
    };
    this.ledger.set(id, restored);
    return restored;
  }

  private async require(id: string) {
    const payment = await this.lookup(id);
    if (!payment) throw new GatewayError('Cobrança simulada não encontrada.', 404, 'not_processed');
    return payment;
  }

  async createPayment(input: CreateGatewayPayment): Promise<GatewayPayment> {
    const id = idFor(input.reference);
    // A referência é única por tentativa: repetir devolve a mesma cobrança, nunca outra.
    const existing = await this.lookup(id);
    if (existing) return { ...existing };

    let payment: GatewayPayment;
    if (input.method === 'pix') {
      payment = {
        id,
        status: 'pending',
        statusDetail: null,
        amountCents: input.amountCents,
        externalReference: input.reference,
        // Referência claramente falsa: não é um payload Pix e nenhum banco a reconhece.
        pix: { copyPaste: `SIMULADO-NAO-PAGAVEL-${input.reference.slice(0, 8).toUpperCase()}`, qrBase64: null, expiresAt: input.expiresAt },
      };
    } else if (input.cardToken === 'sim_approved' || input.cardToken === 'sim_refused') {
      const approved = input.cardToken === 'sim_approved';
      payment = {
        id,
        status: approved ? 'approved' : 'refused',
        statusDetail: approved ? null : 'cc_rejected_insufficient_amount',
        amountCents: input.amountCents,
        externalReference: input.reference,
        pix: null,
      };
    } else if (input.cardToken === 'sim_error') {
      throw new GatewayError('Falha de processamento simulada.', 503, 'not_processed');
    } else {
      throw new GatewayError('Cenário de cartão simulado inválido.', 400, 'not_processed');
    }
    this.ledger.set(id, payment);
    return { ...payment };
  }

  async getPayment(providerPaymentId: string): Promise<GatewayPayment> {
    return { ...(await this.require(providerPaymentId)) };
  }

  async findByReference(reference: string): Promise<GatewayPayment | null> {
    const payment = await this.lookup(idFor(reference));
    return payment ? { ...payment } : null;
  }

  async cancelPayment(providerPaymentId: string): Promise<void> {
    const payment = await this.require(providerPaymentId);
    if (payment.status !== 'pending') throw new GatewayError('Só cobrança pendente pode ser cancelada.', 400, 'not_processed');
    this.ledger.set(providerPaymentId, { ...payment, status: 'cancelled' });
  }

  async refundPayment(providerPaymentId: string): Promise<void> {
    const payment = await this.require(providerPaymentId);
    if (payment.status === 'refunded') throw new GatewayError('Cobrança simulada já estornada.', 400, 'not_processed');
    if (payment.status !== 'approved') throw new GatewayError('Só cobrança aprovada pode ser estornada.', 400, 'not_processed');
    this.ledger.set(providerPaymentId, { ...payment, status: 'refunded' });
  }

  /** O "cliente paga o Pix": exclusivo do simulador. Só vale para Pix pendente e ainda precisa passar por `apply()`. */
  async confirmPix(providerPaymentId: string): Promise<void> {
    const payment = await this.require(providerPaymentId);
    if (payment.status !== 'pending' || !payment.pix) throw new GatewayError('Só um Pix simulado pendente pode ser confirmado.', 409, 'not_processed');
    this.ledger.set(providerPaymentId, { ...payment, status: 'approved' });
  }

  /** Não há webhook no simulador: a conciliação é sempre por consulta (sync). */
  verifyWebhook() {
    return false;
  }
}
