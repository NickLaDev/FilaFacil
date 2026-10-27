import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../../config/env.js';
import { BRAND_NAME } from '../../common/brand.js';
import { MessageDeliveryError, type DeliveryErrorCode } from './delivery-error.js';
import { InfobipSmsSender } from './infobip-sms.sender.js';
import { TwilioSmsSender } from './twilio-sms.sender.js';

export interface SendOptions {
  /** Assunto do e-mail (por finalidade). Ignorado em SMS. */
  subject?: string;
}

/**
 * Canal de envio desacoplado do fornecedor. Para produção, implemente um provider real
 * (ex.: Twilio/Zenvia para SMS, SES/Resend para e-mail) e registre-o no NotificationsModule.
 */
export abstract class MessageSender {
  abstract readonly provider: string;
  abstract readonly available: boolean;
  abstract send(destination: string, destinationMasked: string, message: string, options?: SendOptions): Promise<void>;
}

export abstract class SmsSender extends MessageSender {}
export abstract class EmailSender extends MessageSender {}

/** Desenvolvimento: a mensagem (com o código) aparece no log da API. Bloqueado em produção pela validação do .env. */
class DevLogSender {
  readonly provider = 'dev-log';
  readonly available = true;
  private readonly logger: Logger;

  constructor(channel: string) {
    this.logger = new Logger(`${channel} dev`);
  }

  async send(_destination: string, destinationMasked: string, message: string) {
    this.logger.warn(`→ ${destinationMasked}: ${message}`);
  }
}

class DisabledSender {
  readonly provider = 'none';
  readonly available = false;

  async send() {
    throw new Error('Nenhum provider de envio configurado.');
  }
}

const SMTP_CODES: Record<string, DeliveryErrorCode> = {
  ETIMEDOUT: 'timeout',
  ESOCKETTIMEDOUT: 'timeout',
  EAUTH: 'auth',
  ECONNECTION: 'connection',
  ECONNREFUSED: 'connection',
  ECONNRESET: 'connection',
  ENOTFOUND: 'connection',
  ESOCKET: 'connection',
  EENVELOPE: 'rejected',
  EMESSAGE: 'rejected',
};

function smtpError(error: unknown): MessageDeliveryError {
  if (error instanceof MessageDeliveryError) return error;
  const { code, responseCode } = (error ?? {}) as { code?: string; responseCode?: number };
  const mapped = (code && SMTP_CODES[code]) || (typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600 ? 'rejected' : 'unknown');
  return new MessageDeliveryError('email', mapped, `Falha no envio por SMTP (${code ?? 'sem código'}).`, responseCode ?? null);
}

/** Envio real por SMTP (Nodemailer) com timeouts e erros tipados. Credenciais só por variáveis de ambiente. */
export class SmtpEmailSender {
  readonly provider = 'smtp';
  readonly available = true;
  private readonly transporter: Pick<Transporter, 'sendMail'>;

  constructor(
    private readonly env: Env,
    transporter?: Pick<Transporter, 'sendMail'>,
  ) {
    const timeout = env.SMTP_TIMEOUT_MS ?? 10_000;
    this.transporter =
      transporter ??
      createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        // Porta 587 (STARTTLS): exige TLS para que usuário e senha nunca trafeguem em texto puro se o servidor não oferecer STARTTLS.
        requireTLS: !env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
        connectionTimeout: timeout,
        greetingTimeout: timeout,
        socketTimeout: timeout,
      });
  }

  async send(destination: string, _destinationMasked: string, message: string, options: SendOptions = {}) {
    try {
      const info = (await this.transporter.sendMail({
        from: this.env.SMTP_FROM,
        to: destination,
        subject: options.subject ?? `${BRAND_NAME}: seu código`,
        text: message,
      })) as { rejected?: unknown[] } | undefined;
      if (info?.rejected?.length) throw new MessageDeliveryError('email', 'rejected', 'O servidor SMTP rejeitou o destinatário.');
    } catch (error) {
      throw smtpError(error);
    }
  }
}

export const createSmsSender = (env: Pick<Env, 'SMS_PROVIDER'> & Partial<Env>): SmsSender => {
  if (env.SMS_PROVIDER === 'infobip') {
    return new InfobipSmsSender({
      baseUrl: env.INFOBIP_BASE_URL ?? '',
      apiKey: env.INFOBIP_API_KEY ?? '',
      sender: env.INFOBIP_SENDER ?? '',
      timeoutMs: env.INFOBIP_TIMEOUT_MS ?? 10_000,
    });
  }
  if (env.SMS_PROVIDER === 'twilio') {
    return new TwilioSmsSender({
      accountSid: env.TWILIO_ACCOUNT_SID ?? '',
      authToken: env.TWILIO_AUTH_TOKEN ?? '',
      from: env.TWILIO_FROM || undefined,
      messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID || undefined,
      timeoutMs: env.TWILIO_TIMEOUT_MS ?? 10_000,
    });
  }
  return env.SMS_PROVIDER === 'dev' ? new DevLogSender('SMS') : new DisabledSender();
};

export const createEmailSender = (env: Env): EmailSender => {
  if (env.EMAIL_PROVIDER === 'smtp') return new SmtpEmailSender(env);
  return env.EMAIL_PROVIDER === 'dev' ? new DevLogSender('E-mail') : new DisabledSender();
};
