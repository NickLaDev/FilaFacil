import type { EstablishmentStatus } from '@filafacil/shared';

/** Unidade em que o gestor trabalha (vínculo validado pela API a cada requisição). */
export interface ManagerUnit {
  id: string;
  name: string;
  status: EstablishmentStatus;
  address: string;
  organizationId: string;
}

/** Props comuns às seções do painel: todas operam sobre a unidade selecionada. */
export interface ManagerSectionProps {
  unit: ManagerUnit;
  /** Unidades da mesma organização às quais o gestor tem acesso (duplicação de layout). */
  units: ManagerUnit[];
  notify: (message: string) => void;
}
