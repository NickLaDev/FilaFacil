import { useCallback, useMemo, useState } from 'react';
import type { FloorLayout, FloorTable } from '@/types/floor';

export type LayoutDraft = Pick<FloorLayout, 'tables' | 'merges'>;

const MIN_POSITION = 4;
const MAX_POSITION = 96;

export const clampPosition = (value: number) => Math.round(Math.min(MAX_POSITION, Math.max(MIN_POSITION, value)));

const toDraft = (layout: FloorLayout): LayoutDraft => ({ tables: layout.tables, merges: layout.merges });

/**
 * Edição acontece num rascunho; o atendente só vê a planta depois de "Salvar layout".
 * `base` é a versão do servidor em que o rascunho se apoia: se outra pessoa salvar antes,
 * a API recusa a gravação (409) em vez de sobrescrever.
 */
export function useFloorDraft(saved: FloorLayout) {
  const [base, setBase] = useState(saved);
  const [draft, setDraft] = useState<LayoutDraft>(() => toDraft(saved));
  const [lastSaved, setLastSaved] = useState(saved);

  const dirty = useMemo(
    () => JSON.stringify(draft.tables) !== JSON.stringify(base.tables) || JSON.stringify(draft.merges) !== JSON.stringify(base.merges),
    [draft, base],
  );

  // Planta atualizada no servidor (outra aba/pessoa): sem rascunho pendente, o editor acompanha.
  if (saved !== lastSaved) {
    setLastSaved(saved);
    if (!dirty) {
      setBase(saved);
      setDraft(toDraft(saved));
    }
  }

  const reset = useCallback((layout: FloorLayout) => {
    setBase(layout);
    setDraft(toDraft(layout));
  }, []);

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

  return { draft, setDraft, dirty, baseVersion: base.version, reset, updateTable, removeTable };
}
