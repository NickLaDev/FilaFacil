import { useState } from 'react';
import { Copy, Eye, QrCode } from 'lucide-react';
import { BrandMark } from '@/components/brand/Logo';
import EmptyState from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import { BRAND } from '@/config/brand';
import { cn } from '@/lib/utils';
import { useFloorLayout } from '@/services/floorService';
import type { FloorTable } from '@/types/floor';
import type { ManagerSectionProps } from '../types';

/** Padrão ilustrativo do protótipo; a imagem real do QR seria gerada a partir do código. */
const QR_PREVIEW_FILLED_CELLS = [0, 1, 4, 5, 2, 7, 8, 10, 12, 14];

interface Props extends ManagerSectionProps {
  onOpenFloorPlan: () => void;
}

/** Ficha 02: cada mesa tem um código único que vincula o pedido do cliente à mesa. */
export default function QRCodesSection({ unit, notify, onOpenFloorPlan }: Props) {
  const layout = useFloorLayout(unit.id);
  const [preview, setPreview] = useState<FloorTable | null>(null);

  async function copyCode(table: FloorTable) {
    try {
      await navigator.clipboard.writeText(table.qrCode);
      notify(`Código da ${table.label} copiado`);
    } catch {
      notify('Não foi possível copiar — selecione o código manualmente');
    }
  }

  if (layout.tables.length === 0) {
    return (
      <div className="p-6">
        <div className="bg-card border border-border rounded-xl">
          <EmptyState
            icon={QrCode}
            title="Nenhuma mesa cadastrada"
            description="Os QR Codes são gerados automaticamente quando você adiciona mesas na planta do salão."
            action={
              <button onClick={onOpenFloorPlan} className="bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium">
                Ir para a planta do salão
              </button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        {layout.tables.length} QR Codes ativos · códigos únicos gerados ao criar a mesa na planta. Ao escanear, o cliente cai no cardápio já vinculado à mesa.
      </p>
      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        <table className="w-full min-w-[520px]">
          <thead className="bg-muted/40 border-b border-border">
            <tr>
              {['Mesa', 'Código', 'Capacidade', ''].map(header => (
                <th key={header} className="text-left text-xs text-muted-foreground font-medium px-5 py-3">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {layout.tables.map(table => (
              <tr key={table.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                <td className="px-5 py-3 text-sm font-medium text-foreground">{table.label}</td>
                <td className="px-5 py-3 text-xs font-mono text-foreground">{table.qrCode}</td>
                <td className="px-5 py-3 text-sm text-muted-foreground">{table.capacity} lugares</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => setPreview(table)} title="Visualizar" aria-label={`Visualizar QR da ${table.label}`} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground">
                      <Eye size={13} />
                    </button>
                    <button onClick={() => copyCode(table)} title="Copiar código" aria-label={`Copiar código da ${table.label}`} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground">
                      <Copy size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {preview && (
        <Modal title="QR Code da mesa" onClose={() => setPreview(null)}>
          <div className="border-2 border-dashed border-border rounded-xl p-6 text-center mb-5 bg-white">
            <p className="text-xs text-muted-foreground mb-1">{unit.name}</p>
            <p className="font-display font-bold text-foreground text-xl mb-4">{preview.label}</p>
            <div className="w-28 h-28 mx-auto bg-foreground rounded-xl flex items-center justify-center mb-3" aria-hidden="true">
              <div className="grid grid-cols-4 gap-0.5 p-2">
                {Array.from({ length: 16 }, (_, index) => (
                  <div key={index} className={cn('w-4 h-4 rounded-sm', QR_PREVIEW_FILLED_CELLS.includes(index) ? 'bg-white' : 'bg-foreground')} />
                ))}
              </div>
            </div>
            <p className="font-mono text-sm text-foreground mb-3">{preview.qrCode}</p>
            <p className="text-sm text-foreground font-medium mb-1">Peça sem enfrentar fila</p>
            <p className="text-xs text-muted-foreground mb-3">Escaneie com seu celular</p>
            <div className="flex items-center justify-center gap-1.5">
              <BrandMark size={14} color="#E8700A" />
              <span className="text-xs font-bold text-muted-foreground">{BRAND.name}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPreview(null)} className="flex-1 border border-border text-foreground py-3 rounded-xl text-sm font-medium">
              Fechar
            </button>
            <button onClick={() => copyCode(preview)} className="flex-1 bg-primary text-white py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
              <Copy size={15} />
              Copiar código
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
