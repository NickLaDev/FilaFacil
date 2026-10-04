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

    SMS_PROVIDER: z.enum(['dev', 'none']).default('none'),
    EMAIL_PROVIDER: z.enum(['dev', 'none']).default('none'),

    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    APPLE_CLIENT_ID: optional,
    APPLE_TEAM_ID: optional,
    APPLE_KEY_ID: optional,
    APPLE_PRIVATE_KEY: optional,

    STORAGE_DRIVER: z.enum(['local']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('storage/uploads'),
    UPLOAD_MAX_BYTES: z.coerce.number().int().positive().max(10 * 1024 * 1024).default(2 * 1024 * 1024),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
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
