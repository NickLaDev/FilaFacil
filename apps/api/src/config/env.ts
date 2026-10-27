import { z } from 'zod';

const secret = z.string().min(32, 'use pelo menos 32 caracteres aleatórios');
const key32 = z
  .string()
  .refine(value => Buffer.from(value, 'base64').length === 32, 'deve ser uma chave de 32 bytes em base64');
const optional = z.string().trim().default('');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    WEB_ORIGIN: z.url(),
    API_PUBLIC_URL: z.url(),
    /** Valor do `trust proxy` do Express (IP real atrás do proxy do Vite ou do balanceador). */
    TRUST_PROXY: z.string().default('loopback'),
    DATABASE_URL: z.url(),

    JWT_ACCESS_SECRET: secret,
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    COOKIE_SECURE: z.stringbool().default(false),

    CPF_HMAC_SECRET: secret,
    CPF_ENCRYPTION_KEY: key32,
    OTP_HMAC_SECRET: secret,

    /** Domínio das credenciais WebAuthn (biometria). Vazio = host de WEB_ORIGIN. Mudar invalida as credenciais salvas. */
    WEBAUTHN_RP_ID: optional,

    SMS_PROVIDER: z.enum(['dev', 'twilio', 'infobip', 'none']).default('none'),
    /** Twilio (SMS_PROVIDER=twilio): credenciais só por variável de ambiente, nunca no código nem no log. */
    TWILIO_ACCOUNT_SID: optional,
    TWILIO_AUTH_TOKEN: optional,
    /** Número remetente em E.164 (ex.: +15551234567) ou, no lugar dele, o Messaging Service SID. */
    TWILIO_FROM: optional,
    TWILIO_MESSAGING_SERVICE_SID: optional,
    TWILIO_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
    /** Infobip (SMS_PROVIDER=infobip): API v3, com chave limitada ao escopo sms:message:send. */
    INFOBIP_BASE_URL: optional,
    INFOBIP_API_KEY: optional,
    INFOBIP_SENDER: optional,
    INFOBIP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
    SMTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
    /** Aviso de pedido pronto também por SMS (ficha 05). Desligado por padrão. */
    ORDER_READY_SMS: z.stringbool().default(false),
    EMAIL_PROVIDER: z.enum(['dev', 'smtp', 'none']).default('none'),
    SMTP_HOST: optional,
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    /** true = TLS direto (porta 465); false = STARTTLS quando o servidor oferece (porta 587). */
    SMTP_SECURE: z.stringbool().default(false),
    SMTP_USER: optional,
    SMTP_PASS: optional,
    /** Remetente dos e-mails (ex.: "FilaFácil <no-reply@exemplo.com>"). */
    SMTP_FROM: optional,

    /**
     * Gateway de pagamento. `none` recusa pagamentos (503). `simulated` é só para demonstração (nenhum dinheiro
     * é movido): exige ALLOW_SIMULATED_PAYMENTS=true e é recusado em produção.
     */
    PAYMENT_PROVIDER: z.enum(['mercadopago', 'simulated', 'none']).default('none'),
    /** Opt-in explícito para o gateway simulado. */
    ALLOW_SIMULATED_PAYMENTS: z.stringbool().default(false),
    MP_ACCESS_TOKEN: optional,
    /** Assinatura secreta do webhook (painel do Mercado Pago > Webhooks). */
    MP_WEBHOOK_SECRET: optional,
    /** URL pública de POST /payments/webhook. Vazio em desenvolvimento local: a sincronização cobre. */
    PAYMENT_WEBHOOK_URL: optional,

    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    APPLE_CLIENT_ID: optional,
    APPLE_TEAM_ID: optional,
    APPLE_KEY_ID: optional,
    APPLE_PRIVATE_KEY: optional,

    /** Desliga o rate limit (só testes/desenvolvimento): recusado em produção. */
    THROTTLE_DISABLED: z.stringbool().default(false),

    STORAGE_DRIVER: z.enum(['local']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('storage/uploads'),
    UPLOAD_MAX_BYTES: z.coerce.number().int().positive().max(10 * 1024 * 1024).default(2 * 1024 * 1024),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER === 'smtp') {
      for (const key of ['SMTP_HOST', 'SMTP_FROM'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'obrigatório com EMAIL_PROVIDER=smtp' });
      }
    }
    if (env.SMS_PROVIDER === 'twilio') {
      for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'obrigatório com SMS_PROVIDER=twilio' });
      }
      if (!env.TWILIO_FROM && !env.TWILIO_MESSAGING_SERVICE_SID) {
        ctx.addIssue({ code: 'custom', path: ['TWILIO_FROM'], message: 'informe TWILIO_FROM ou TWILIO_MESSAGING_SERVICE_SID' });
      }
    }
    if (env.SMS_PROVIDER === 'infobip') {
      for (const key of ['INFOBIP_BASE_URL', 'INFOBIP_API_KEY', 'INFOBIP_SENDER'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'obrigatório com SMS_PROVIDER=infobip' });
      }
      if (env.INFOBIP_BASE_URL) {
        try {
          const url = new URL(/^https?:\/\//i.test(env.INFOBIP_BASE_URL) ? env.INFOBIP_BASE_URL : `https://${env.INFOBIP_BASE_URL}`);
          if (url.protocol !== 'https:' || (url.hostname !== 'api.infobip.com' && !url.hostname.endsWith('.api.infobip.com'))) throw new Error();
        } catch {
          ctx.addIssue({ code: 'custom', path: ['INFOBIP_BASE_URL'], message: 'use a URL HTTPS *.api.infobip.com exibida no portal' });
        }
      }
    }
    if (env.PAYMENT_PROVIDER === 'simulated') {
      if (env.NODE_ENV === 'production') {
        ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'o gateway simulado não pode rodar em produção' });
      }
      if (!env.ALLOW_SIMULATED_PAYMENTS) {
        ctx.addIssue({ code: 'custom', path: ['ALLOW_SIMULATED_PAYMENTS'], message: 'obrigatório com PAYMENT_PROVIDER=simulated (opt-in explícito)' });
      }
    }
    // Decisão da Sprint 3: só o gateway simulado é permitido. Um gateway real exige reconciliação periódica dos pagamentos
    // pendentes e recuperação segura após falhas (hoje só há conciliação sob demanda no fechamento da comanda). Remova este
    // bloqueio apenas junto com essa implementação e a validação financeira correspondente.
    if (env.PAYMENT_PROVIDER === 'mercadopago') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'gateway real bloqueado: exige reconciliação periódica de pagamentos pendentes (não implementada)' });
    }
    if (env.PAYMENT_PROVIDER === 'mercadopago' && !env.MP_ACCESS_TOKEN) {
      ctx.addIssue({ code: 'custom', path: ['MP_ACCESS_TOKEN'], message: 'obrigatório com PAYMENT_PROVIDER=mercadopago' });
    }
    if (env.NODE_ENV !== 'production') return;
    if (env.PAYMENT_PROVIDER === 'mercadopago' && !env.MP_WEBHOOK_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['MP_WEBHOOK_SECRET'], message: 'obrigatório em produção (autentica o webhook)' });
    }
    if (env.THROTTLE_DISABLED) ctx.addIssue({ code: 'custom', path: ['THROTTLE_DISABLED'], message: 'não pode desligar o rate limit em produção' });
    if (!env.COOKIE_SECURE) ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'obrigatório em produção' });
    for (const key of ['SMS_PROVIDER', 'EMAIL_PROVIDER'] as const) {
      if (env[key] === 'dev') ctx.addIssue({ code: 'custom', path: [key], message: 'provider de desenvolvimento não pode rodar em produção' });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Valida o ambiente no boot: configuração inválida derruba a API antes de aceitar requisições. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  const problems = result.error.issues.map(issue => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
  throw new Error(`Configuração inválida:\n${problems}`);
}
