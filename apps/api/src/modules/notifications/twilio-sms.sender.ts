import { toE164Br } from '@filafacil/shared';
import { MessageDeliveryError, type DeliveryErrorCode } from './delivery-error.js';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  from?: string;
  messagingServiceSid?: string;
  timeoutMs: number;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Códigos do Twilio para destino inválido / não permitido (conta trial só envia para números verificados). */
const INVALID_DESTINATION = new Set([21211, 21614, 21408, 21610]);
const REJECTED = new Set([21608, 21612, 21606]);

/**
 * SMS pela API REST do Twilio (sem SDK). Normaliza o celular para E.164 brasileiro, aplica timeout e devolve
 * erros tipados. Conta trial pode restringir destinatários/remetente: a recusa chega como `rejected`, sem suposições.
 */
export class TwilioSmsSender {
  readonly provider = 'twilio';
  readonly available = true;

  constructor(
    private readonly config: TwilioConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(destination: string, _destinationMasked: string, message: string) {
    const to = toE164Br(destination);
    if (!to) throw new MessageDeliveryError('sms', 'invalid_destination', 'Celular fora do padrão brasileiro (+55 DDD número).');

    const body = new URLSearchParams({ To: to, Body: message });
    if (this.config.messagingServiceSid) body.set('MessagingServiceSid', this.config.messagingServiceSid);
    else if (this.config.from) body.set('From', this.config.from);

    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.config.accountSid)}/Messages.json`;
    const credentials = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new MessageDeliveryError('sms', timedOut ? 'timeout' : 'connection', timedOut ? 'Twilio não respondeu a tempo.' : 'Sem conexão com o Twilio.');
    }
    if (response.ok) return;

    let providerCode: number | null = null;
    try {
      const json = (await response.json()) as { code?: unknown };
      if (typeof json.code === 'number') providerCode = json.code;
    } catch {
      // corpo ilegível: vale só o status HTTP
    }
    throw new MessageDeliveryError('sms', classify(response.status, providerCode), `Twilio recusou o envio (HTTP ${response.status}${providerCode ? `, código ${providerCode}` : ''}).`, response.status);
  }
}

function classify(status: number, providerCode: number | null): DeliveryErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (providerCode !== null && INVALID_DESTINATION.has(providerCode)) return 'invalid_destination';
  if (providerCode !== null && REJECTED.has(providerCode)) return 'rejected';
  if (status >= 500) return 'unknown';
  return status >= 400 ? 'rejected' : 'unknown';
}
