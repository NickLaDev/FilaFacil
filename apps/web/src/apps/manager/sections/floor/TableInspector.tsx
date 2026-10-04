import type { ReactNode } from 'react';
import { Combine, MousePointerClick, Split, Trash2, Users } from 'lucide-react';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import { SHAPE_LABELS } from '@/components/floor/tableStyles';
import { cn } from '@/lib/utils';
import { findMergeForTable, mergeSummary } from '@/services/floorService';
import type { FloorTable, TableMerge, TableShape } from '@/types/floor';
import type { LayoutDraft } from './useFloorDraft';

const MIN_CAPACITY = 1;
const MAX_CAPACITY = 20;

interface Props {
  draft: LayoutDraft;
  selectedIds: string[];
  selectedMerge: TableMerge | null;
  onUpdateTable: (id: string, patch: Partial<FloorTable>) => void;
  onRemoveTable: (id: string) => void;
  onMerge: () => void;
  onUnmerge: (mergeId: string) => void;
}

export default function TableInspector({ draft, selectedIds, selectedMerge, onUpdateTable, onRemoveTable, onMerge, onUnmerge }: Props) {
  if (selectedMerge) {
    const summary = mergeSummary(selectedMerge, draft.tables);
    return (
      <Panel title={summary.label}>
        <p className="text-sm text-muted-foreground flex items-center gap-1.5">
          <Users size={13} />
          {summary.capacity} lugares no total
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">No mapa do atendente estas mesas aparecem como uma única mesa.</p>
        <button onClick={() => onUnmerge(selectedMerge.id)} className="w-full flex items-center justify-center gap-2 border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-muted">
          <Split size={14} />
          Desfazer mesclagem
        </button>
      </Panel>
    );
  }

  if (selectedIds.length > 1) {
    const tables = draft.tables.filter(t => selectedIds.includes(t.id));
    const alreadyMerged = tables.some(t => findMergeForTable(draft.merges, t.id));
    return (
      <Panel title={`${tables.length} mesas selecionadas`}>
        <p className="text-sm text-muted-foreground">{tables.map(t => t.label).join(', ')}</p>
        <p className="text-sm text-foreground">Capacidade somada: {tables.reduce((sum, t) => sum + t.capacity, 0)} lugares</p>
        {alreadyMerged && <p className="text-xs text-warning">Alguma mesa já está mesclada — desfaça a mesclagem anterior antes.</p>}
        <button
          onClick={onMerge}
          disabled={alreadyMerged}
          className="w-full flex items-center justify-center gap-2 bg-primary text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          <Combine size={14} />
          Mesclar mesas
        </button>
      </Panel>
    );
  }

  const table = draft.tables.find(t => t.id === selectedIds[0]);
  if (!table) {
    return (
      <Panel title="Editar planta">
        <ul className="text-sm text-muted-foreground flex flex-col gap-2 leading-relaxed">
          <li className="flex gap-2"><MousePointerClick size={14} className="flex-shrink-0 mt-0.5" />Arraste as mesas para posicioná-las como no salão.</li>
          <li>Clique em uma mesa para editar nome, formato e capacidade.</li>
          <li>Para eventos, selecione duas ou mais mesas (Ctrl/⌘ + clique ou "Selecionar para mesclar") e mescle em uma comanda única.</li>
        </ul>
      </Panel>
    );
  }

  const merge = findMergeForTable(draft.merges, table.id);
  return (
    <Panel title={table.label}>
      <FormField label="Nome da mesa" htmlFor="table-label" error={table.label.trim() ? undefined : 'Informe um nome.'}>
        <input id="table-label" value={table.label} maxLength={20} onChange={e => onUpdateTable(table.id, { label: e.target.value })} className={PANEL_INPUT_CLASS} />
      </FormField>
      <FormField label="Formato">
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(SHAPE_LABELS) as TableShape[]).map(shape => (
            <button
              key={shape}
              onClick={() => onUpdateTable(table.id, { shape })}
              aria-pressed={table.shape === shape}
              className={cn(
                'py-2 rounded-lg text-xs font-medium border transition-colors',
                table.shape === shape ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {SHAPE_LABELS[shape]}
            </button>
          ))}
        </div>
      </FormField>
      <FormField label="Capacidade (lugares)" htmlFor="table-capacity">
        <input
          id="table-capacity"
          type="number"
          min={MIN_CAPACITY}
          max={MAX_CAPACITY}
          value={table.capacity}
          onChange={e => {
            const value = Number.parseInt(e.target.value, 10);
            if (Number.isFinite(value)) onUpdateTable(table.id, { capacity: Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, value)) });
          }}
          className={PANEL_INPUT_CLASS}
        />
      </FormField>
      <div className="text-xs text-muted-foreground">
        QR Code: <span className="font-mono text-foreground">{table.qrCode || 'gerado ao salvar'}</span>
      </div>
      {merge && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-xs text-foreground">Faz parte de {mergeSummary(merge, draft.tables).label}.</p>
          <button onClick={() => onUnmerge(merge.id)} className="text-xs text-primary font-medium text-left">
            Desfazer mesclagem
          </button>
        </div>
      )}
      <button onClick={() => onRemoveTable(table.id)} className="w-full flex items-center justify-center gap-2 bg-error/10 text-error rounded-xl py-2.5 text-sm font-medium hover:bg-error/20">
        <Trash2 size={14} />
        Remover mesa
      </button>
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="w-full xl:w-72 bg-card border border-border rounded-xl p-5 flex-shrink-0 flex flex-col gap-4 self-start">
      <p className="font-display font-bold text-foreground">{title}</p>
      {children}
    </aside>
  );
}
