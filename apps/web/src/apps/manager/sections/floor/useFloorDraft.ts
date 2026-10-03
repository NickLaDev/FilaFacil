import { useCallback, useMemo, useState } from 'react';
import { getFloorLayout, useFloorLayout } from '@/services/floorService';
import type { FloorLayout, FloorTable } from '@/types/floor';

export type LayoutDraft = Pick<FloorLayout, 'tables' | 'merges'>;

const MIN_POSITION = 4;
const MAX_POSITION = 96;

export const clampPosition = (value: number) => Math.round(Math.min(MAX_POSITION, Math.max(MIN_POSITION, value)));

/** Edição acontece num rascunho; o atendente só vê a planta depois de "Salvar layout". */
export function useFloorDraft(establishmentId: string) {
  const saved = useFloorLayout(establishmentId);
  const [draft, setDraft] = useState<LayoutDraft>(() => ({ tables: saved.tables, merges: saved.merges }));

  const dirty = useMemo(
    () => JSON.stringify(draft.tables) !== JSON.stringify(saved.tables) || JSON.stringify(draft.merges) !== JSON.stringify(saved.merges),
    [draft, saved],
  );

  const reset = useCallback(() => {
    const latest = getFloorLayout(establishmentId);
    setDraft({ tables: latest.tables, merges: latest.merges });
  }, [establishmentId]);

  const updateTable = useCallback((id: string, patch: Partial<FloorTable>) => {
    setDraft(prev => {
      const current = prev.tables.find(t => t.id === id);
      if (!current || (Object.keys(patch) as (keyof FloorTable)[]).every(key => current[key] === patch[key])) return prev;
      return { ...prev, tables: prev.tables.map(t => (t.id === id ? { ...t, ...patch } : t)) };
    });
  }, []);

  /** Remover uma mesa também a tira das mesclagens; grupos com menos de 2 mesas deixam de existir. */
  const removeTable = useCallback((id: string) => {
    setDraft(prev => ({
      tables: prev.tables.filter(t => t.id !== id),
      merges: prev.merges
        .map(merge => ({ ...merge, tableIds: merge.tableIds.filter(tableId => tableId !== id) }))
        .filter(merge => merge.tableIds.length >= 2),
    }));
  }, []);

  return { draft, setDraft, dirty, reset, updateTable, removeTable };
}
