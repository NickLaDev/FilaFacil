import { toE164Br } from '@filafacil/shared';
import { MessageDeliveryError, type DeliveryErrorCode } from './delivery-error.js';

export interface InfobipConfig {
  baseUrl: string;
  apiKey: string;
  sender: string;
  timeoutMs: number;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

type SendResponse = {
  messages?: Array<{ status?: { groupName?: string } }>;
};

/** SMS pela API v3 da Infobip. A chave nunca entra em mensagens de erro ou logs. */
export class InfobipSmsSender {
  readonly provider = 'infobip';
  readonly available = true;

  constructor(
    private readonly config: InfobipConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(destination: string, _destinationMasked: string, message: string) {
    const e164 = toE164Br(destination);
    if (!e164) throw new MessageDeliveryError('sms', 'invalid_destination', 'Celular fora do padrão brasileiro (+55 DDD número).');
    // A API da Infobip documenta e gera os destinos no formato internacional só com dígitos.
    const to = e164.replace(/^\+/, '');

    let response: Response;
    try {
      response = await this.fetchImpl(`${normalizeBaseUrl(this.config.baseUrl)}/sms/3/messages`, {
        method: 'POST',
        headers: {
          Authorization: `App ${this.config.apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              sender: this.config.sender,
              destinations: [{ to }],
              content: { text: message },
            },
          ],
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new MessageDeliveryError('sms', timedOut ? 'timeout' : 'connection', timedOut ? 'Infobip não respondeu a tempo.' : 'Sem conexão com a Infobip.');
    }

    if (!response.ok) {
      throw new MessageDeliveryError('sms', classify(response.status), `Infobip recusou o envio (HTTP ${response.status}).`, response.status);
    }

    // A API é assíncrona: PENDING significa que aceitou o SMS, não que o aparelho recebeu.
    // Uma rejeição síncrona no corpo nunca pode ser tratada como sucesso.
    try {
      const result = (await response.json()) as SendResponse;
      if (result.messages?.some(item => item.status?.groupName === 'REJECTED')) {
        throw new MessageDeliveryError('sms', 'rejected', 'Infobip rejeitou o envio.', response.status);
      }
    } catch (error) {
      if (error instanceof MessageDeliveryError) throw error;
      // Algumas respostas de sucesso podem não trazer JSON; o status HTTP ainda confirma aceitação pelo provedor.
    }
  }
}

function normalizeBaseUrl(value: string) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/+$/, '');
}

function classify(status: number): DeliveryErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unknown';
  return status >= 400 ? 'rejected' : 'unknown';
}
