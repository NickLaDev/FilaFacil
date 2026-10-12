import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../../config/env.js';
import { BRAND_NAME } from '../../common/brand.js';

/**
 * Canal de envio desacoplado do fornecedor. Para produção, implemente um provider real
 * (ex.: Twilio/Zenvia para SMS, SES/Resend para e-mail) e registre-o no NotificationsModule.
 */
export abstract class MessageSender {
  abstract readonly provider: string;
  abstract readonly available: boolean;
  abstract send(destination: string, destinationMasked: string, message: string): Promise<void>;
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

/** Envio real por SMTP (Nodemailer). Credenciais só por variáveis de ambiente. */
class SmtpEmailSender {
  readonly provider = 'smtp';
  readonly available = true;
  private readonly transporter: Transporter;

  constructor(private readonly env: Env) {
    this.transporter = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }

  async send(destination: string, _destinationMasked: string, message: string) {
    await this.transporter.sendMail({ from: this.env.SMTP_FROM, to: destination, subject: `${BRAND_NAME}: seu código`, text: message });
  }
}

export const createSmsSender = (provider: 'dev' | 'none'): SmsSender =>
  provider === 'dev' ? new DevLogSender('SMS') : new DisabledSender();

export const createEmailSender = (env: Env): EmailSender => {
  if (env.EMAIL_PROVIDER === 'smtp') return new SmtpEmailSender(env);
  return env.EMAIL_PROVIDER === 'dev' ? new DevLogSender('E-mail') : new DisabledSender();
};
