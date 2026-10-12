import { expect, request, type APIRequestContext, type APIResponse, type BrowserContext } from '@playwright/test';
import { API_URL, CLIENT_HEADER, PASSWORD, SEED } from './env';
import { bucketFor, pace } from './pacer';

const SESSION_REUSE_MS = 7 * 60_000;
const apiCache = new Map<string, { api: Api; at: number }>();
const cookieCache = new Map<string, { cookies: any[]; at: number }>();

/** O rate limit de login é do IP e pode ser consumido por outros processos; espera e tenta de novo (nunca o desliga). */
async function loginWithRetry(call: () => Promise<Res>): Promise<Res> {
  let r = await call();
  for (let i = 0; i < 6 && r.status === 429 && r.body?.code === 'TOO_MANY_REQUESTS'; i++) {
    console.log(`[e2e] login 429 (${new Date().toISOString()}), aguardando 20 s: ${JSON.stringify(r.body)}`);
    await new Promise(res => setTimeout(res, 20_000));
    r = await call();
  }
  return r;
}

export interface Res<T = any> {
  status: number;
  body: T;
  ms: number;
}

/** Cliente HTTP da API real (cookies de sessão + header anti-CSRF), para preparar/verificar estado. Nunca stub. */
export class Api {
  private constructor(readonly ctx: APIRequestContext) {}

  static async create(): Promise<Api> {
    return new Api(await request.newContext({ baseURL: `${API_URL}/`, extraHTTPHeaders: CLIENT_HEADER }));
  }

  /** Reaproveita os cookies de um contexto de navegador (mesma sessão da UI). */
  static fromBrowser(context: BrowserContext): Api {
    return new Api(context.request);
  }

  /** Login real pela API. Sessões de contas do seed são reaproveitadas por até 7 min (token de acesso dura 10) para poupar o limite de login. */
  static async as(email: string, password = PASSWORD, opts: { fresh?: boolean } = {}): Promise<Api> {
    const key = `${email}:${password}`;
    const hit = apiCache.get(key);
    if (!opts.fresh && hit && Date.now() - hit.at < SESSION_REUSE_MS) return hit.api;
    const api = await Api.create();
    const r = await loginWithRetry(() => api.post('auth/login', { email, password }));
    if (r.status !== 200 && r.status !== 201) throw new Error(`login ${email} falhou: ${r.status} ${JSON.stringify(r.body)}`);
    if (!opts.fresh) apiCache.set(key, { api, at: Date.now() });
    return api;
  }

  private abs = (path: string) => (path.startsWith('http') ? path : `${API_URL}/${path.replace(/^\//, '')}`);

  private async wrap(call: () => Promise<APIResponse>): Promise<Res> {
    const t = Date.now();
    const res = await call();
    const text = await res.text();
    let body: any = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* texto puro */
    }
    return { status: res.status(), body, ms: Date.now() - t };
  }

  get = (path: string, params?: Record<string, string | number | boolean>) => this.wrap(() => this.ctx.get(this.abs(path), { params, headers: CLIENT_HEADER }));
  /** `raw: true` ignora o pacer (usado só por testes que provam o rate limit). */
  post = async (path: string, data?: unknown, opts: { raw?: boolean } = {}) => {
    const bucket = opts.raw ? null : bucketFor(path);
    if (bucket) await pace(bucket);
    return this.wrap(() => this.ctx.post(this.abs(path), { data, headers: CLIENT_HEADER }));
  };
  put = (path: string, data?: unknown) => this.wrap(() => this.ctx.put(this.abs(path), { data, headers: CLIENT_HEADER }));
  patch = (path: string, data?: unknown) => this.wrap(() => this.ctx.patch(this.abs(path), { data, headers: CLIENT_HEADER }));
  del = (path: string, data?: unknown) => this.wrap(() => this.ctx.delete(this.abs(path), { data, headers: CLIENT_HEADER }));
  dispose = () => this.ctx.dispose();
}

/** Autentica o contexto do navegador pela API (cookies HttpOnly ficam no contexto). Os testes de login usam a UI. */
export async function loginContext(context: BrowserContext, email: string, password = PASSWORD, opts: { fresh?: boolean } = {}) {
  const key = `${email}:${password}`;
  const hit = cookieCache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < SESSION_REUSE_MS) {
    await context.addCookies(hit.cookies);
    return;
  }
  const doLogin = async (): Promise<Res> => {
    await pace('login');
    const r = await context.request.post(`${API_URL}/auth/login`, { data: { email, password }, headers: CLIENT_HEADER });
    return { status: r.status(), body: await r.json().catch(() => null), ms: 0 };
  };
  const r = await loginWithRetry(doLogin);
  if (r.status !== 200) throw new Error(`login ${email} falhou: ${r.status} ${JSON.stringify(r.body)}`);
  if (!opts.fresh) cookieCache.set(key, { cookies: (await context.cookies()).filter(c => c.name.startsWith('ff_')), at: Date.now() });
}

// ─── atalhos de domínio ─────────────────────────────────────────────────────

export const qr = async (api: Api, code: string) => (await api.get(`restaurants/qr/${code}`)).body;

export const tableByQr = async (api: Api, establishmentId: string, code: string) => {
  const fp = (await api.get(`establishments/${establishmentId}/floor-plan`)).body;
  return fp.tables.find((t: any) => t.qrCode === code);
};

export const menuItems = async (api: Api, establishmentId: string) => (await api.get(`restaurants/${establishmentId}/menu`)).body.items as any[];

export function clientRequestId() {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Cria pedido pela API (mesmo contrato que o app usa). */
export async function createOrder(api: Api, o: { establishmentId: string; tableId?: string; items: { menuItemId: string; quantity: number; notes?: string }[]; expectedTotalCents?: number; clientRequestId?: string }) {
  return api.post('orders', { clientRequestId: clientRequestId(), ...o });
}

export const payApproved = (api: Api, orderId: string, expectedTotalCents?: number) =>
  api.post(`orders/${orderId}/payments`, { method: 'credit', cardToken: 'sim_approved', paymentMethodId: 'simulated', expectedTotalCents });

/** Pedido já pago pelo cliente (cartão simulado aprovado). Retorna o pedido. */
export async function paidOrder(api: Api, establishmentId: string, tableId: string | undefined, items: { menuItemId: string; quantity: number }[]) {
  const created = await createOrder(api, { establishmentId, tableId, items });
  if (created.status >= 300) throw new Error(`createOrder: ${created.status} ${JSON.stringify(created.body)}`);
  const paid = await payApproved(api, created.body.id, created.body.totalCents);
  if (paid.status >= 300) throw new Error(`pay: ${paid.status} ${JSON.stringify(paid.body)}`);
  return paid.body;
}

export { SEED };

// Matcher: recusa ESPERADA de cliente (400–499). Um 500 do servidor nunca satisfaz (evita falso positivo de `>= 400`).
expect.extend({
  toBeClientError(received: number) {
    const pass = Number.isInteger(received) && received >= 400 && received < 500;
    return { pass, message: () => `esperado status 4xx (recusa do cliente), recebido ${received}` };
  },
});
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace PlaywrightTest {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface Matchers<R, T = unknown> {
      toBeClientError(): R;
    }
  }
}
