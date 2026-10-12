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

    SMS_PROVIDER: z.enum(['dev', 'none']).default('none'),
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
    if (env.PAYMENT_PROVIDER === 'simulated') {
      if (env.NODE_ENV === 'production') {
        ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'o gateway simulado não pode rodar em produção' });
      }
      if (!env.ALLOW_SIMULATED_PAYMENTS) {
        ctx.addIssue({ code: 'custom', path: ['ALLOW_SIMULATED_PAYMENTS'], message: 'obrigatório com PAYMENT_PROVIDER=simulated (opt-in explícito)' });
      }
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
