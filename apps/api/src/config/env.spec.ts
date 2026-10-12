import { parseEnv } from './env.js';

const base: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:5173',
  API_PUBLIC_URL: 'http://localhost:5173/api',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  CPF_HMAC_SECRET: 'b'.repeat(40),
  CPF_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  OTP_HMAC_SECRET: 'c'.repeat(40),
};

describe('configuração de e-mail e pagamento', () => {
  it('padrão: sem provider, nada é enviado nem cobrado', () => {
    const env = parseEnv(base);
    expect(env.EMAIL_PROVIDER).toBe('none');
    expect(env.PAYMENT_PROVIDER).toBe('none');
  });

  it('SMTP exige servidor e remetente', () => {
    expect(() => parseEnv({ ...base, EMAIL_PROVIDER: 'smtp' })).toThrow(/SMTP_HOST/);
    expect(parseEnv({ ...base, EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.exemplo.com', SMTP_FROM: 'App <no-reply@exemplo.com>' }).SMTP_PORT).toBe(587);
  });

  it('Mercado Pago exige o token; em produção, também o segredo do webhook', () => {
    expect(() => parseEnv({ ...base, PAYMENT_PROVIDER: 'mercadopago' })).toThrow(/MP_ACCESS_TOKEN/);
    const configured = { ...base, PAYMENT_PROVIDER: 'mercadopago', MP_ACCESS_TOKEN: 'TEST-token' };
    expect(parseEnv(configured).PAYMENT_PROVIDER).toBe('mercadopago');
    expect(() => parseEnv({ ...configured, NODE_ENV: 'production', COOKIE_SECURE: 'true', EMAIL_PROVIDER: 'none', SMS_PROVIDER: 'none' })).toThrow(/MP_WEBHOOK_SECRET/);
    expect(parseEnv({ ...configured, NODE_ENV: 'production', COOKIE_SECURE: 'true', SMS_PROVIDER: 'none', MP_WEBHOOK_SECRET: 'segredo' }).MP_WEBHOOK_SECRET).toBe('segredo');
  });

  it('provider de e-mail de desenvolvimento continua proibido em produção', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true', EMAIL_PROVIDER: 'dev', SMS_PROVIDER: 'none' })).toThrow(/EMAIL_PROVIDER/);
  });

  it('o pagamento simulado exige opt-in explícito e nunca roda em produção', () => {
    expect(() => parseEnv({ ...base, PAYMENT_PROVIDER: 'simulated' })).toThrow(/ALLOW_SIMULATED_PAYMENTS/);
    expect(() => parseEnv({ ...base, PAYMENT_PROVIDER: 'simulated', ALLOW_SIMULATED_PAYMENTS: 'false' })).toThrow(/ALLOW_SIMULATED_PAYMENTS/);
    expect(parseEnv({ ...base, PAYMENT_PROVIDER: 'simulated', ALLOW_SIMULATED_PAYMENTS: 'true' }).PAYMENT_PROVIDER).toBe('simulated');
    // A flag sozinha não liga nada: o padrão continua seguro.
    expect(parseEnv({ ...base, ALLOW_SIMULATED_PAYMENTS: 'true' }).PAYMENT_PROVIDER).toBe('none');
    const production = { ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true', SMS_PROVIDER: 'none', PAYMENT_PROVIDER: 'simulated', ALLOW_SIMULATED_PAYMENTS: 'true' };
    expect(() => parseEnv(production)).toThrow(/simulado não pode rodar em produção/);
  });

  it('o rate limit não pode ser desligado em produção', () => {
    const production = { ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true', SMS_PROVIDER: 'none', EMAIL_PROVIDER: 'none' };
    expect(() => parseEnv({ ...production, THROTTLE_DISABLED: 'true' })).toThrow(/THROTTLE_DISABLED/);
    expect(parseEnv({ ...production, THROTTLE_DISABLED: 'false' }).THROTTLE_DISABLED).toBe(false);
    expect(parseEnv({ ...base, THROTTLE_DISABLED: 'true' }).THROTTLE_DISABLED).toBe(true);
  });
});
