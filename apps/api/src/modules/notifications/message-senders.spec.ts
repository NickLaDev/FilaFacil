import { createEmailSender } from './message-senders.js';
import type { Env } from '../../config/env.js';

const env = (overrides: Partial<Env>) => ({ EMAIL_PROVIDER: 'none', SMTP_PORT: 587, SMTP_SECURE: false, ...overrides }) as Env;

describe('provider de e-mail', () => {
  it('sem provider configurado o envio fica indisponível (a API responde 503 em vez de fingir)', () => {
    expect(createEmailSender(env({ EMAIL_PROVIDER: 'none' })).available).toBe(false);
  });

  it('smtp usa o Nodemailer com as credenciais do ambiente', () => {
    const sender = createEmailSender(env({ EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.exemplo.com', SMTP_FROM: 'App <no-reply@exemplo.com>' }));
    expect(sender).toMatchObject({ provider: 'smtp', available: true });
  });

  it('dev apenas escreve no log', () => {
    expect(createEmailSender(env({ EMAIL_PROVIDER: 'dev' })).provider).toBe('dev-log');
  });
});
