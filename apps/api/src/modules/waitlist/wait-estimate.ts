/** Tempo médio para uma mesa compatível vagar — base da estimativa enquanto não há histórico de giro. */
export const AVERAGE_TABLE_TURNOVER_MIN = 12;

/**
 * Ficha 21: grupos à frente consomem as mesas livres compatíveis; quem sobra espera
 * um giro médio por grupo excedente.
 */
export function estimateWaitMinutes(groupsAhead: number, freeCompatibleTables: number) {
  if (groupsAhead < freeCompatibleTables) return 0;
  return (groupsAhead - freeCompatibleTables + 1) * AVERAGE_TABLE_TURNOVER_MIN;
}

/** Rótulo de mesas liberadas juntas (ex.: "Mesas 3 + 4"). */
export function releasedTablesLabel(labels: string[]) {
  if (labels.length === 1) return labels[0] as string;
  return `Mesas ${labels.map(label => label.replace(/\D/g, '') || label).join(' + ')}`;
}
