import type { Permission, UserRole } from '@filafacil/shared';

/** Identidade da requisição, resolvida pelo AccessTokenGuard a partir da sessão no banco. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  name: string;
  role: UserRole;
  permissions: ReadonlySet<Permission>;
}

export interface RequestMeta {
  userAgent: string | undefined;
  ipAddress: string | undefined;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
