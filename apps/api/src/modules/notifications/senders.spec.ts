import { toE164Br } from '@filafacil/shared';
import { parseEnv } from '../../config/env.js';
import type { Env } from '../../config/env.js';
import { MessageDeliveryError } from './delivery-error.js';
import { InfobipSmsSender } from './infobip-sms.sender.js';
import { createSmsSender, SmtpEmailSender } from './message-senders.js';
import { TwilioSmsSender } from './twilio-sms.sender.js';

const config = { accountSid: 'ACtest', authToken: 'segredo-token', from: '+15550001111', timeoutMs: 1000 };
const reply = (status: number, body: unknown = {}) => async () => new Response(JSON.stringify(body), { status });

describe('E.164 brasileiro', () => {
  it('normaliza celular, fixo e número com 55', () => {
    expect(toE164Br('(19) 99999-0000')).toBe('+5519999990000');
    expect(toE164Br('1933334444')).toBe('+551933334444');
    expect(toE164Br('+55 19 99999-0000')).toBe('+5519999990000');
  });
  it('recusa números inválidos', () => {
    for (const bad of ['', '123', '0199999000', '19899990000', '1099999000', '+1 555 000 1111']) expect(toE164Br(bad)).toBeNull();
  });
});

describe('Twilio', () => {
  it('envia To em E.164, autentica com Basic e não vaza o token no erro', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const sender = new TwilioSmsSender(config, async (url, init) => {
      captured = { url, init };
      return new Response('{}', { status: 201 });
    });
    await sender.send('19999990000', 'x', 'olá');
    const sent = captured as unknown as { url: string; init: RequestInit };
    expect(sent.url).toContain('/Accounts/ACtest/Messages.json');
    expect(String(sent.init.body)).toContain('To=%2B5519999990000');
    expect(String(sent.init.body)).toContain('From=%2B15550001111');
    const failing = new TwilioSmsSender(config, reply(401, { code: 20003 }));
    const error = await failing.send('19999990000', 'x', 'olá').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'auth' });
    expect((error as Error).message).not.toContain('segredo-token');
  });

  it('destino inválido nem chega ao provedor', async () => {
    let called = false;
    const sender = new TwilioSmsSender(config, async () => ((called = true), new Response('{}')));
    await expect(sender.send('123', 'x', 'm')).rejects.toMatchObject({ code: 'invalid_destination' });
    expect(called).toBe(false);
  });

  it('classifica recusas, limite, falha de servidor e timeout (nenhuma vira sucesso)', async () => {
    const cases: [number, unknown, string][] = [
      [400, { code: 21211 }, 'invalid_destination'],
      [400, { code: 21608 }, 'rejected'],
      [429, {}, 'rate_limited'],
      [500, {}, 'unknown'],
    ];
    for (const [status, body, code] of cases) {
      await expect(new TwilioSmsSender(config, reply(status, body)).send('19999990000', 'x', 'm')).rejects.toMatchObject({ code });
    }
    const timeout = new TwilioSmsSender(config, async () => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    });
    await expect(timeout.send('19999990000', 'x', 'm')).rejects.toMatchObject({ code: 'timeout' });
  });

  it('a fábrica escolhe o provider e o env exige credenciais', () => {
    expect(createSmsSender({ SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+1' } as Env).provider).toBe('twilio');
    expect(createSmsSender({ SMS_PROVIDER: 'infobip', INFOBIP_BASE_URL: 'abc.api.infobip.com', INFOBIP_API_KEY: 'k', INFOBIP_SENDER: 'ServiceSMS' } as Env).provider).toBe('infobip');
    expect(createSmsSender({ SMS_PROVIDER: 'none' }).available).toBe(false);
    const base = {
      NODE_ENV: 'test',
      WEB_ORIGIN: 'http://localhost:5173',
      API_PUBLIC_URL: 'http://localhost:5173/api',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      CPF_HMAC_SECRET: 'b'.repeat(40),
      CPF_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      OTP_HMAC_SECRET: 'c'.repeat(40),
    };
    expect(() => parseEnv({ ...base, SMS_PROVIDER: 'twilio' })).toThrow(/TWILIO_ACCOUNT_SID/);
    expect(parseEnv({ ...base, SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+15550001111' }).SMS_PROVIDER).toBe('twilio');
    expect(() => parseEnv({ ...base, SMS_PROVIDER: 'infobip' })).toThrow(/INFOBIP_BASE_URL/);
    expect(() => parseEnv({ ...base, SMS_PROVIDER: 'infobip', INFOBIP_BASE_URL: 'https://example.com', INFOBIP_API_KEY: 'k', INFOBIP_SENDER: 'ServiceSMS' })).toThrow(/api\.infobip\.com/);
    expect(parseEnv({ ...base, SMS_PROVIDER: 'infobip', INFOBIP_BASE_URL: 'abc.api.infobip.com', INFOBIP_API_KEY: 'k', INFOBIP_SENDER: 'ServiceSMS' }).SMS_PROVIDER).toBe('infobip');
  });
});

describe('Infobip', () => {
  const config = { baseUrl: 'abc.api.infobip.com', apiKey: 'segredo-infobip', sender: 'ServiceSMS', timeoutMs: 1000 };

  it('envia pela API v3 com destino brasileiro em E.164', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const sender = new InfobipSmsSender(config, async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ messages: [{ status: { groupName: 'PENDING' } }] }), { status: 200 });
    });
    await sender.send('(19) 99999-0000', 'x', 'Seu código é 123456');
    const sent = captured as unknown as { url: string; init: RequestInit };
    expect(sent.url).toBe('https://abc.api.infobip.com/sms/3/messages');
    expect(sent.init.headers).toMatchObject({ Authorization: 'App segredo-infobip', Accept: 'application/json', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(sent.init.body))).toMatchObject({ messages: [{ sender: 'ServiceSMS', destinations: [{ to: '5519999990000' }], content: { text: 'Seu código é 123456' } }] });
  });

  it('recusa destino inválido antes de chamar o provedor', async () => {
    let called = false;
    const sender = new InfobipSmsSender(config, async () => ((called = true), new Response('{}')));
    await expect(sender.send('123', 'x', 'm')).rejects.toMatchObject({ code: 'invalid_destination' });
    expect(called).toBe(false);
  });

  it('classifica falhas sem vazar a chave', async () => {
    const cases: [number, string][] = [
      [401, 'auth'],
      [403, 'auth'],
      [429, 'rate_limited'],
      [500, 'unknown'],
      [400, 'rejected'],
    ];
    for (const [status, code] of cases) {
      const sender = new InfobipSmsSender(config, reply(status));
      const error = await sender.send('19999990000', 'x', 'm').catch((e: unknown) => e);
      expect(error).toMatchObject({ code });
      expect((error as Error).message).not.toContain(config.apiKey);
    }
    const rejected = new InfobipSmsSender(config, reply(200, { messages: [{ status: { groupName: 'REJECTED' } }] }));
    await expect(rejected.send('19999990000', 'x', 'm')).rejects.toMatchObject({ code: 'rejected' });
    const timeout = new InfobipSmsSender(config, async () => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    });
    await expect(timeout.send('19999990000', 'x', 'm')).rejects.toMatchObject({ code: 'timeout' });
  });
});

const transportOptions = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock('nodemailer', () => ({
  createTransport: (options: Record<string, unknown>) => {
    transportOptions.last = options;
    return { sendMail: async () => ({ rejected: [] }) };
  },
}));

describe('SMTP', () => {
  it('opções do transporte: STARTTLS obrigatório na 587, TLS direto na 465, com timeouts', () => {
    const base = { SMTP_HOST: 'smtp.exemplo.com', SMTP_FROM: 'a@b.c', SMTP_PORT: 587, SMTP_TIMEOUT_MS: 4000 } as Env;
    new SmtpEmailSender({ ...base, SMTP_SECURE: false });
    expect(transportOptions.last).toMatchObject({ secure: false, requireTLS: true, connectionTimeout: 4000, greetingTimeout: 4000, socketTimeout: 4000 });
    new SmtpEmailSender({ ...base, SMTP_PORT: 465, SMTP_SECURE: true });
    expect(transportOptions.last).toMatchObject({ secure: true, requireTLS: false });
  });

  const env = { SMTP_FROM: 'App <a@b.c>', SMTP_PORT: 587, SMTP_SECURE: false, SMTP_TIMEOUT_MS: 1000 } as Env;

  it('usa o assunto da finalidade', async () => {
    const calls: { subject?: string }[] = [];
    const sender = new SmtpEmailSender(env, { sendMail: async (m: { subject?: string }) => (calls.push(m), { rejected: [] }) } as never);
    await sender.send('a@b.c', 'x', 'corpo', { subject: 'Seu pedido está pronto' });
    expect(calls[0]?.subject).toBe('Seu pedido está pronto');
  });

  it('mapeia erros do transporte para erros tipados', async () => {
    const fail = (code: string, responseCode?: number) =>
      new SmtpEmailSender(env, {
        sendMail: async () => {
          throw Object.assign(new Error('x'), { code, responseCode });
        },
      } as never).send('a@b.c', 'x', 'm');
    await expect(fail('ETIMEDOUT')).rejects.toMatchObject({ code: 'timeout' });
    await expect(fail('EAUTH', 535)).rejects.toMatchObject({ code: 'auth' });
    await expect(fail('ECONNECTION')).rejects.toMatchObject({ code: 'connection' });
    await expect(fail('EXYZ', 550)).rejects.toMatchObject({ code: 'rejected' });
    await expect(fail('EXYZ')).rejects.toBeInstanceOf(MessageDeliveryError);
  });

  it('destinatário rejeitado pelo servidor não é sucesso', async () => {
    const sender = new SmtpEmailSender(env, { sendMail: async () => ({ rejected: ['a@b.c'] }) } as never);
    await expect(sender.send('a@b.c', 'x', 'm')).rejects.toMatchObject({ code: 'rejected' });
  });
});
