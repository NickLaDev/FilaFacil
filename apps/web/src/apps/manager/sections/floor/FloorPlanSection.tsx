import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Combine, Copy, Lock, Map as MapIcon, Plus, Users } from 'lucide-react';
import { UNLIMITED } from '@filafacil/shared';
import FloorCanvas, { MergeBlock, TableNode } from '@/components/floor/FloorCanvas';
import { shortTableLabel } from '@/components/floor/tableStyles';
import EmptyState from '@/components/ui/EmptyState';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { errorMessage, isApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { createFloorTable, fetchFloorLayout, mergeSummary, mergeTables, saveFloorLayout, unmergeTables, useFloorLayout } from '@/services/floorService';
import { useEstablishmentPlan } from '@/services/planService';
import type { FloorLayout, FloorTable } from '@/types/floor';
import type { ManagerSectionProps } from '../../types';
import DuplicateLayoutModal from './DuplicateLayoutModal';
import TableInspector from './TableInspector';
import { clampPosition, useFloorDraft } from './useFloorDraft';

const KEYBOARD_STEP = 1;
const KEYBOARD_STEP_FAST = 5;
const ARROW_DELTAS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Fichas 20, 47 e 61: editor visual da planta, mesclagem de mesas e duplicação entre unidades. */
export default function FloorPlanSection(props: ManagerSectionProps) {
  const { layout, error, refetch } = useFloorLayout(props.unit.id);
  if (error) return <ErrorBlock error={error} onRetry={() => void refetch()} />;
  if (!layout) return <LoadingBlock />;
  return <FloorEditor {...props} saved={layout} />;
}

function FloorEditor({ unit, units, notify, saved }: ManagerSectionProps & { saved: FloorLayout }) {
  const { draft, setDraft, dirty, baseVersion, reset, updateTable, removeTable } = useFloorDraft(saved);
  const plan = useEstablishmentPlan(unit.id).data;
  const canDuplicate = plan?.features.includes('layout_duplication') ?? false;
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedMergeId, setSelectedMergeId] = useState<string | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);
  // Guarda a distância entre o ponteiro e o centro da mesa para ela não "pular" ao começar a arrastar.
  const dragRef = useRef<{ tableId: string; pointerId: number; offsetX: number; offsetY: number } | null>(null);

  const tableLimit = plan && plan.limits.tables < UNLIMITED ? plan.limits.tables : null;
  const atTableLimit = tableLimit !== null && draft.tables.length >= tableLimit;
  const selectedMerge = draft.merges.find(m => m.id === selectedMergeId) ?? null;

  function clearSelection() {
    setSelectedIds([]);
    setSelectedMergeId(null);
  }

  function addTable() {
    const table = createFloorTable(draft.tables);
    setDraft(prev => ({ ...prev, tables: [...prev.tables, table] }));
    setSelectedMergeId(null);
    setSelectedIds([table.id]);
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>, table: FloorTable) {
    if (event.button !== 0) return;
    setSelectedMergeId(null);
    if (mergeMode || event.ctrlKey || event.metaKey) {
      setSelectedIds(prev => (prev.includes(table.id) ? prev.filter(id => id !== table.id) : [...prev, table.id]));
      return;
    }
    setSelectedIds([table.id]);
    const pointer = pointerPosition(event);
    if (!pointer) return;
    dragRef.current = { tableId: table.id, pointerId: event.pointerId, offsetX: table.x - pointer.x, offsetY: table.y - pointer.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerPosition(event: PointerEvent<HTMLButtonElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 };
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    const pointer = pointerPosition(event);
    if (!drag || drag.pointerId !== event.pointerId || !pointer) return;
    updateTable(drag.tableId, { x: clampPosition(pointer.x + drag.offsetX), y: clampPosition(pointer.y + drag.offsetY) });
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, table: FloorTable) {
    const delta = ARROW_DELTAS[event.key];
    if (!delta) return;
    event.preventDefault();
    const step = event.shiftKey ? KEYBOARD_STEP_FAST : KEYBOARD_STEP;
    updateTable(table.id, { x: clampPosition(table.x + delta[0] * step), y: clampPosition(table.y + delta[1] * step) });
  }

  function mergeSelected() {
    const next = mergeTables(draft, selectedIds);
    setDraft(next);
    setSelectedIds([]);
    setSelectedMergeId(next.merges.at(-1)?.id ?? null);
    setMergeMode(false);
  }

  function unmerge(mergeId: string) {
    setDraft(prev => unmergeTables(prev, mergeId));
    setSelectedMergeId(null);
  }

  async function save() {
    const labels = draft.tables.map(t => t.label.trim().toLowerCase());
    if (labels.some(label => !label)) return setError('Todas as mesas precisam de um nome.');
    if (new Set(labels).size !== labels.length) return setError('Existem mesas com o mesmo nome.');
    setSaving(true);
    try {
      const savedLayout = await saveFloorLayout(unit.id, {
        version: baseVersion,
        tables: draft.tables.map(t => ({ ...t, label: t.label.trim() })),
        merges: draft.merges,
      });
      reset(savedLayout);
      clearSelection();
      setError('');
      notify('Planta salva — o mapa do atendente já foi atualizado');
    } catch (failure) {
      setError(
        isApiError(failure, 'FLOOR_PLAN_CONFLICT')
          ? 'Outra pessoa salvou a planta enquanto você editava. Descarte para carregar a versão atual.'
          : errorMessage(failure, 'Não foi possível salvar a planta.'),
      );
    } finally {
      setSaving(false);
    }
  }

  async function discard() {
    reset(await fetchFloorLayout(unit.id));
    clearSelection();
    setError('');
  }

  return (
    <div className="p-6 flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={addTable}
          disabled={atTableLimit}
          title={atTableLimit ? `Limite de ${tableLimit} mesas do plano ${plan?.name ?? ''}` : undefined}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
        >
          <Plus size={14} />
          Adicionar mesa
        </button>
        {draft.tables.length > 1 && (
          <button
            onClick={() => {
              setMergeMode(value => !value);
              clearSelection();
            }}
            aria-pressed={mergeMode}
            className={cn(
              'flex items-center gap-2 border px-4 py-2 rounded-xl text-sm font-medium transition-colors',
              mergeMode ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground hover:bg-muted',
            )}
          >
            <Combine size={14} />
            {mergeMode ? 'Cancelar seleção' : 'Selecionar para mesclar'}
          </button>
        )}
        {mergeMode && selectedIds.length >= 2 && (
          <button onClick={mergeSelected} className="flex items-center gap-2 bg-foreground text-background px-4 py-2 rounded-xl text-sm font-medium">
            Mesclar {selectedIds.length} mesas
          </button>
        )}
        <button
          onClick={() => setShowDuplicate(true)}
          disabled={!canDuplicate}
          title={canDuplicate ? undefined : `Duplicar layout não está incluído no plano ${plan?.name ?? 'atual'}`}
          className="flex items-center gap-2 border border-border text-foreground px-4 py-2 rounded-xl text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent"
        >
          {canDuplicate ? <Copy size={14} /> : <Lock size={14} />}
          Duplicar de outra unidade
        </button>

        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-xs font-medium text-warning">Alterações não salvas</span>}
          <button onClick={() => void discard()} disabled={!dirty && !error} className="border border-border text-muted-foreground px-4 py-2 rounded-xl text-sm hover:bg-muted disabled:opacity-50">
            Descartar
          </button>
          <button onClick={() => void save()} disabled={!dirty || saving} className="bg-success text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
            {saving ? 'Salvando…' : 'Salvar layout'}
          </button>
        </div>
      </div>
      {error && <p className="text-error text-sm">{error}</p>}

      <div className="flex flex-col xl:flex-row gap-6 items-start">
        <div className="flex-1 w-full min-w-0">
          {draft.tables.length === 0 ? (
            <div className="bg-card border border-border rounded-xl">
              <EmptyState
                icon={MapIcon}
                title="Planta vazia"
                description={`Desenhe o salão de ${unit.name} adicionando mesas${canDuplicate ? ' ou copie a planta de outra unidade' : ''}.`}
                action={
                  <div className="flex gap-2">
                    <button onClick={addTable} className="bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium">
                      Adicionar mesa
                    </button>
                    {canDuplicate && (
                      <button onClick={() => setShowDuplicate(true)} className="border border-border px-4 py-2 rounded-xl text-sm font-medium hover:bg-muted">
                        Duplicar de outra unidade
                      </button>
                    )}
                  </div>
                }
              />
            </div>
          ) : (
            <FloorCanvas canvasRef={canvasRef} editable onBackgroundClick={clearSelection}>
              {draft.merges.map(merge => {
                const summary = mergeSummary(merge, draft.tables);
                if (summary.members.length < 2) return null;
                return (
                  <MergeBlock
                    key={merge.id}
                    members={summary.members}
                    variant="outline"
                    selected={merge.id === selectedMergeId}
                    ariaLabel={`Selecionar ${summary.label}`}
                    onClick={() => {
                      setSelectedIds([]);
                      setSelectedMergeId(merge.id);
                    }}
                  >
                    {summary.label} · {summary.capacity} lugares
                  </MergeBlock>
                );
              })}
              {draft.tables.map(table => {
                const isSelected = selectedIds.includes(table.id);
                return (
                  <TableNode
                    key={table.id}
                    table={table}
                    toneClassName={isSelected ? 'bg-primary/10 border-primary text-primary' : 'border-foreground/20 text-foreground'}
                    selected={isSelected}
                    ariaLabel={`${table.label}, ${table.capacity} lugares. Arraste ou use as setas para mover.`}
                    onPointerDown={event => handlePointerDown(event, table)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onKeyDown={event => handleKeyDown(event, table)}
                    className={mergeMode ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}
                  >
                    <span className="font-display font-bold text-xs">{shortTableLabel(table.label)}</span>
                    <span className="text-[10px] opacity-70 flex items-center gap-0.5">
                      <Users size={9} />
                      {table.capacity}
                    </span>
                  </TableNode>
                );
              })}
            </FloorCanvas>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            O mapa do atendente usa esta planta salva. {draft.tables.length} mesa{draft.tables.length === 1 ? '' : 's'}
            {tableLimit !== null ? ` de ${tableLimit} permitidas no plano ${plan?.name}` : ''}.
          </p>
        </div>

        {draft.tables.length > 0 && (
          <TableInspector
            draft={draft}
            selectedIds={selectedIds}
            selectedMerge={selectedMerge}
            onUpdateTable={updateTable}
            onRemoveTable={id => {
              removeTable(id);
              setSelectedIds(prev => prev.filter(selected => selected !== id));
            }}
            onMerge={mergeSelected}
            onUnmerge={unmerge}
          />
        )}
      </div>

      {showDuplicate && (
        <DuplicateLayoutModal
          target={unit}
          units={units}
          hasUnsavedChanges={dirty}
          onClose={() => setShowDuplicate(false)}
          onDuplicated={async sourceName => {
            reset(await fetchFloorLayout(unit.id));
            clearSelection();
            notify(`Planta de ${sourceName} copiada para ${unit.name}`);
          }}
        />
      )}
    </div>
  );
}
