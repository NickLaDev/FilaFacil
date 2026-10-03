import { useState } from 'react';
import { AlertTriangle, Copy } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { cn } from '@/lib/utils';
import { duplicateFloorLayout, getFloorLayout, qrPrefixFromName } from '@/services/floorService';
import type { Establishment } from '@/types/establishment';

interface Props {
  target: Establishment;
  units: Establishment[];
  hasUnsavedChanges: boolean;
  onClose: () => void;
  onDuplicated: (sourceName: string) => void;
}

/** Ficha 61: copia mesas, posições e capacidades de outra unidade da mesma organização. */
export default function DuplicateLayoutModal({ target, units, hasUnsavedChanges, onClose, onDuplicated }: Props) {
  const sources = units
    .filter(u => u.id !== target.id)
    .map(u => ({ unit: u, tableCount: getFloorLayout(u.id).tables.length }))
    .filter(source => source.tableCount > 0);
  const [sourceId, setSourceId] = useState(sources[0]?.unit.id ?? '');
  const source = sources.find(s => s.unit.id === sourceId);

  function confirm() {
    if (!source) return;
    duplicateFloorLayout(source.unit.id, target.id, qrPrefixFromName(target.name));
    onDuplicated(source.unit.name);
    onClose();
  }

  return (
    <Modal title="Duplicar layout" onClose={onClose} width="md">
      {sources.length === 0 ? (
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
      <div className="flex gap-3 mt-5">
        <button onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">
          Cancelar
        </button>
        <button onClick={confirm} disabled={!source} className="flex-1 bg-primary text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
          <Copy size={14} />
          Duplicar planta
        </button>
      </div>
    </Modal>
  );
}
