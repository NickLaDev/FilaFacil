import { useState } from 'react';
import { AlertTriangle, Copy } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { errorMessage, isApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { duplicateFloorLayout, useDuplicateTargets } from '@/services/floorService';
import type { ManagerUnit } from '../../types';

interface Props {
  /** Unidade cuja planta salva serve de modelo. */
  source: ManagerUnit;
  hasUnsavedChanges: boolean;
  onClose: () => void;
  onDuplicated: (targetName: string) => void;
}

/** Ficha 61: copia mesas, posições e capacidades para outra unidade da mesma organização; a origem não muda. */
export default function DuplicateLayoutModal({ source, hasUnsavedChanges, onClose, onDuplicated }: Props) {
  const targets = useDuplicateTargets(source.id);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [needsReplace, setNeedsReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const eligible = (targets.data ?? []).filter(target => target.eligible);
  const targetId = chosenId ?? eligible[0]?.id ?? '';
  const target = eligible.find(t => t.id === targetId);

  async function confirm(replace: boolean) {
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      await duplicateFloorLayout(source.id, target.id, replace);
      onDuplicated(target.name);
      onClose();
    } catch (failure) {
      if (isApiError(failure, 'TARGET_LAYOUT_NOT_EMPTY')) setNeedsReplace(true);
      else setError(errorMessage(failure, 'Não foi possível duplicar a planta.'));
      setBusy(false);
    }
  }

  return (
    <Modal title="Duplicar layout" onClose={onClose} width="md">
      {targets.error ? (
        <ErrorBlock error={targets.error} onRetry={() => void targets.refetch()} />
      ) : !targets.data ? (
        <LoadingBlock />
      ) : targets.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Não há outra unidade da organização para receber a planta.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">Escolha a unidade que receberá a planta de {source.name}.</p>
          <div className="flex flex-col gap-2">
            {targets.data.map(item => (
              <label
                key={item.id}
                className={cn(
                  'flex items-center gap-3 border rounded-xl px-4 py-3 transition-colors',
                  item.eligible ? 'cursor-pointer' : 'opacity-60',
                  targetId === item.id && item.eligible ? 'border-primary bg-primary/5' : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name="layout-target"
                  disabled={!item.eligible}
                  checked={targetId === item.id && item.eligible}
                  onChange={() => {
                    setChosenId(item.id);
                    setNeedsReplace(false);
                  }}
                  className="accent-primary"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.eligible ? `${item.tableCount} mesas hoje` : (item.reason ?? 'Indisponível')}</p>
                </div>
              </label>
            ))}
          </div>
          {(needsReplace || (target && target.tableCount > 0)) && target && (
            <div className="bg-warning-bg border border-warning/30 rounded-xl p-3 flex gap-2">
              <AlertTriangle size={15} className="text-warning flex-shrink-0 mt-0.5" />
              <p className="text-xs text-warning leading-relaxed">
                A planta atual de {target.name} será substituída. A planta de {source.name} não muda. Cada mesa copiada recebe um QR Code novo.
              </p>
            </div>
          )}
          {hasUnsavedChanges && <p className="text-xs text-warning">Alterações não salvas desta planta não serão copiadas — salve antes.</p>}
        </div>
      )}
      {error && <p className="text-error text-sm mt-3">{error}</p>}
      <div className="flex gap-3 mt-5">
        <button onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">
          Cancelar
        </button>
        <button
          onClick={() => void confirm(needsReplace || (target?.tableCount ?? 0) > 0)}
          disabled={!target || busy}
          className="flex-1 bg-primary text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Copy size={14} />
          {busy ? 'Duplicando…' : 'Duplicar planta'}
        </button>
      </div>
    </Modal>
  );
}
