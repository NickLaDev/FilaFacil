import { CLIENT_HEADER, type ApiErrorBody, type ApiFieldError } from '@filafacil/shared';

export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/+$/, '');

/** Erro padronizado da API; telas decidem a mensagem/fluxo pelo `code`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiFieldError[] = [],
  ) {
    super(message);
  }

  fieldError(field: string) {
    return this.details.find(detail => detail.field === field)?.message;
  }
}

export const isApiError = (error: unknown, code?: string): error is ApiError =>
  error instanceof ApiError && (code === undefined || error.code === code);

/** Mensagem segura para exibir ao usuário (nunca detalhes internos). */
export const errorMessage = (error: unknown, fallback = 'Não foi possível concluir. Tente novamente.') =>
  error instanceof ApiError && error.status < 500 ? error.message : fallback;

type SessionEvent = 'expired' | 'suspended';
const sessionListeners = new Set<(event: SessionEvent) => void>();

/** Avisos de sessão para o app (ex.: suspensão → tela de acesso bloqueado). */
export function onSessionEvent(listener: (event: SessionEvent) => void) {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

export const emitSessionEvent = (event: SessionEvent) => sessionListeners.forEach(listener => listener(event));

const REFRESHABLE_CODES = new Set(['AUTH_REQUIRED', 'ACCESS_TOKEN_EXPIRED']);
let refreshing: Promise<boolean> | null = null;

/** Uma única renovação por vez, mesmo com várias requisições recebendo 401 juntas. */
function refreshSession() {
  refreshing ??= fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { [CLIENT_HEADER.name]: CLIENT_HEADER.value },
  })
    .then(response => {
      if (response.status === 403) emitSessionEvent('suspended');
      return response.ok;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function parseError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
  return new ApiError(response.status, body?.code ?? 'HTTP_ERROR', body?.message ?? 'Não foi possível concluir. Tente novamente.', body?.details ?? []);
}

async function request<T>(method: string, path: string, options: RequestOptions = {}, retried = false): Promise<T> {
  const isForm = options.body instanceof FormData;
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers[CLIENT_HEADER.name] = CLIENT_HEADER.value;
  if (options.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      credentials: 'include',
      headers,
      body: options.body === undefined ? undefined : isForm ? (options.body as FormData) : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Sem conexão com o servidor. Verifique sua internet.');
  }

  if (response.ok) return (response.status === 204 ? undefined : await response.json()) as T;

  const error = await parseError(response);
  if (error.status === 401 && REFRESHABLE_CODES.has(error.code) && !retried && !path.startsWith('/auth/')) {
    if (await refreshSession()) return request<T>(method, path, options, true);
    emitSessionEvent('expired');
  }
  if (error.code === 'ACCOUNT_SUSPENDED') emitSessionEvent('suspended');
  throw error;
}

/** Cliente HTTP único da aplicação: base URL, cookies, CSRF, erros e renovação de sessão. */
export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: <T = void>(path: string, body?: unknown) => request<T>('DELETE', path, { body }),
  upload: <T>(path: string, file: File, method: 'POST' | 'PUT' = 'PUT') => {
    const form = new FormData();
    form.append('file', file);
    return request<T>(method, path, { body: form });
  },
};
