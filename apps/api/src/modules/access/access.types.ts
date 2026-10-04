import type { EstablishmentStatus, Permission, PlanFeature } from '@filafacil/shared';

/** Estabelecimento sobre o qual a requisição atua, já autorizado pelo EstablishmentAccessGuard. */
export interface EstablishmentContext {
  id: string;
  name: string;
  status: EstablishmentStatus;
  planName: string;
  features: ReadonlySet<PlanFeature>;
  limits: { tables: number };
}

export interface EstablishmentRequirement {
  /** Basta uma das permissões listadas (vazio = qualquer membro da equipe). */
  anyPermission: Permission[];
  /** Recurso que o plano contratado precisa incluir. */
  feature?: PlanFeature;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      establishment?: EstablishmentContext;
    }
  }
}
