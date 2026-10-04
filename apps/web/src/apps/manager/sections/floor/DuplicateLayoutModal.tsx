import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { AlertTriangle, Copy } from 'lucide-react';
import type { FloorPlanDto } from '@filafacil/shared';
import Modal from '@/components/ui/Modal';
import { api, errorMessage } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { duplicateFloorLayout } from '@/services/floorService';
import { staffKeys } from '@/services/staffKeys';
import type { ManagerUnit } from '../../types';

interface Props {
  target: ManagerUnit;
  units: ManagerUnit[];
  hasUnsavedChanges: boolean;
  onClose: () => void;
  onDuplicated: (sourceName: string) => Promise<void>;
}

/** Ficha 61: copia mesas, posições e capacidades de outra unidade da mesma organização. */
export default function DuplicateLayoutModal({ target, units, hasUnsavedChanges, onClose, onDuplicated }: Props) {
  const candidates = units.filter(u => u.id !== target.id);
  const plans = useQueries({
    queries: candidates.map(unit => ({
      queryKey: staffKeys.floor(unit.id),
      queryFn: () => api.get<FloorPlanDto>(`/establishments/${unit.id}/floor-plan`),
    })),
  });
  const sources = candidates
    .map((unit, index) => ({ unit, tableCount: plans[index]?.data?.tables.length ?? 0 }))
    .filter(source => source.tableCount > 0);
  const loading = plans.some(plan => plan.isPending);
  const [chosenId, setSourceId] = useState<string | null>(null);
  const sourceId = chosenId ?? sources[0]?.unit.id ?? '';
  const source = sources.find(s => s.unit.id === sourceId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    if (!source) return;
    setBusy(true);
    try {
      await duplicateFloorLayout(source.unit.id, target.id);
      await onDuplicated(source.unit.name);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure, 'Não foi possível duplicar a planta.'));
      setBusy(false);
    }
  }

  return (
    <Modal title="Duplicar layout" onClose={onClose} width="md">
      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando plantas das unidades…</p>
      ) : sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma outra unidade da organização tem planta desenhada para servir de modelo.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">Escolha a planta que servirá de modelo para {target.name}.</p>
          <div className="flex flex-col gap-2">
            {sources.map(({ unit, tableCount }) => (
              <label
                key={unit.id}
                className={cn('flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition-colors', sourceId === unit.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50')}
              >
                <input type="radio" name="layout-source" checked={sourceId === unit.id} onChange={() => setSourceId(unit.id)} className="accent-primary" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{unit.name}</p>
                  <p className="text-xs text-muted-foreground">{tableCount} mesas</p>
                </div>
              </label>
            ))}
          </div>
          <div className="bg-warning-bg border border-warning/30 rounded-xl p-3 flex gap-2">
            <AlertTriangle size={15} className="text-warning flex-shrink-0 mt-0.5" />
            <p className="text-xs text-warning leading-relaxed">
              A planta atual de {target.name} será substituída{hasUnsavedChanges ? ' e as alterações não salvas serão descartadas' : ''}. A planta de origem não muda. Cada
              mesa copiada recebe um QR Code novo.
            </p>
          </div>
        </div>
      )}
      {error && <p className="text-error text-sm mt-3">{error}</p>}
      <div className="flex gap-3 mt-5">
        <button onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">
          Cancelar
        </button>
        <button onClick={() => void confirm()} disabled={!source || busy} className="flex-1 bg-primary text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
          <Copy size={14} />
          Duplicar planta
        </button>
      </div>
    </Modal>
  );
}
