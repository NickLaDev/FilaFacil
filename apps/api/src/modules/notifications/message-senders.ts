import { Logger } from '@nestjs/common';

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

export const createSmsSender = (provider: 'dev' | 'none'): SmsSender =>
  provider === 'dev' ? new DevLogSender('SMS') : new DisabledSender();

export const createEmailSender = (provider: 'dev' | 'none'): EmailSender =>
  provider === 'dev' ? new DevLogSender('E-mail') : new DisabledSender();
