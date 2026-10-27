export type DeliveryChannel = 'sms' | 'email';

/** Causa tipada da falha de envio (nunca carrega credenciais nem o conteúdo da mensagem). */
export type DeliveryErrorCode = 'timeout' | 'auth' | 'connection' | 'rejected' | 'invalid_destination' | 'rate_limited' | 'unknown';

/** Falha de provedor: o chamador registra e informa; nunca trata como sucesso. */
export class MessageDeliveryError extends Error {
  constructor(
    readonly channel: DeliveryChannel,
    readonly code: DeliveryErrorCode,
    message: string,
    readonly providerStatus: number | null = null,
  ) {
    super(message);
    this.name = 'MessageDeliveryError';
  }
}

/** Código registrado no banco/log para qualquer erro de envio. */
export const deliveryErrorCode = (error: unknown): DeliveryErrorCode => (error instanceof MessageDeliveryError ? error.code : 'unknown');
