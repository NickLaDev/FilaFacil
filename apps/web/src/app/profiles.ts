export type Profile = 'client' | 'attendant' | 'manager' | 'admin' | 'partner';

/** Cada perfil é um app independente, servido em seu próprio caminho. */
export const PROFILE_PATHS: Record<Profile, string> = {
  client: '/',
  attendant: '/atendente',
  manager: '/gestor',
  admin: '/admin',
  /** Portal público de cadastro de novos estabelecimentos (ficha 55). */
  partner: '/parceiro',
};

export function profileFromPath(pathname: string): Profile | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const match = (Object.entries(PROFILE_PATHS) as [Profile, string][]).find(([, path]) => path === normalized);
  return match?.[0] ?? null;
}
