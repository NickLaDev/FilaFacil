import type { CSSProperties } from 'react';
import type { FloorTable, TableLiveStatus, TableShape } from '@/types/floor';

export const LIVE_STATUS_STYLE: Record<TableLiveStatus, { tone: string; dot: string; text: string; label: string }> = {
  free: { tone: 'bg-success/10 border-success/30 text-success', dot: 'bg-success', text: 'text-success', label: 'Livre' },
  occupied: { tone: 'bg-primary/10 border-primary/30 text-primary', dot: 'bg-primary', text: 'text-primary', label: 'Ocupada' },
  reserved: { tone: 'bg-blue-500/10 border-blue-500/30 text-blue-500', dot: 'bg-blue-500', text: 'text-blue-500', label: 'Reservada' },
  called: { tone: 'bg-error/10 border-error/30 text-error', dot: 'bg-error', text: 'text-error', label: 'Chamado' },
};

/** Ordem de urgência: uma mesa mesclada assume o status mais urgente entre as mesas que a compõem. */
const STATUS_URGENCY: TableLiveStatus[] = ['called', 'occupied', 'reserved', 'free'];

export function mostUrgentStatus(statuses: TableLiveStatus[]): TableLiveStatus {
  return STATUS_URGENCY.find(status => statuses.includes(status)) ?? 'free';
}

export const SHAPE_LABELS: Record<TableShape, string> = {
  round: 'Redonda',
  square: 'Quadrada',
  rect: 'Retangular',
};

const MAX_TABLE_SIZE_PX = 120;

/** Tamanho em px cresce um pouco com a capacidade, para a planta lembrar o salão real. */
export function tableDimensions(table: Pick<FloorTable, 'shape' | 'capacity'>) {
  const clamp = (value: number) => Math.min(MAX_TABLE_SIZE_PX, value);
  if (table.shape === 'round') {
    const diameter = clamp(44 + table.capacity * 4);
    return { width: diameter, height: diameter };
  }
  if (table.shape === 'square') {
    const side = clamp(48 + table.capacity * 3);
    return { width: side, height: side };
  }
  return { width: clamp(64 + table.capacity * 6), height: 52 };
}

/** Número curto da mesa ("Mesa 12" → "12"); rótulos sem número aparecem inteiros. */
export const shortTableLabel = (label: string) => label.replace(/^Mesa\s+/i, '');

const MERGE_PADDING_PX = 10;

/** Caixa que envolve as mesas mescladas — no mapa do atendente vira uma única unidade (ficha 47). */
export function mergeBoxStyle(members: FloorTable[]): CSSProperties {
  const xs = members.map(t => t.x);
  const ys = members.map(t => t.y);
  const halfWidth = Math.max(...members.map(t => tableDimensions(t).width / 2)) + MERGE_PADDING_PX;
  const halfHeight = Math.max(...members.map(t => tableDimensions(t).height / 2)) + MERGE_PADDING_PX;
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return {
    left: `calc(${minX}% - ${halfWidth}px)`,
    top: `calc(${minY}% - ${halfHeight}px)`,
    width: `calc(${maxX - minX}% + ${halfWidth * 2}px)`,
    height: `calc(${maxY - minY}% + ${halfHeight * 2}px)`,
  };
}
