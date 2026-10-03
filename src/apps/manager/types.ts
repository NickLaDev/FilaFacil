import type { Establishment } from '@/types/establishment';

/** Props comuns às seções do painel: todas operam sobre a unidade selecionada. */
export interface ManagerSectionProps {
  unit: Establishment;
  actorName: string;
  notify: (message: string) => void;
}
