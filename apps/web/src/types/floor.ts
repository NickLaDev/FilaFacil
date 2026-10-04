import type { TableShape } from '@filafacil/shared';

export type { TableShape };

export interface FloorTable {
  id: string;
  label: string;
  shape: TableShape;
  capacity: number;
  /** Posição do centro em % da área da planta (0–100). */
  x: number;
  y: number;
  /** Código único impresso no QR Code (gerado pelo servidor ao salvar a planta). */
  qrCode: string;
}

/** Mesas mescladas (ficha 47, Sprint 2 — ainda guardadas no navegador). */
export interface TableMerge {
  id: string;
  tableIds: string[];
}

export interface FloorLayout {
  /** Versão salva no servidor (0 = planta ainda não desenhada). */
  version: number;
  tables: FloorTable[];
  merges: TableMerge[];
  updatedAt: string | null;
}

export type TableLiveStatus = 'free' | 'occupied' | 'reserved' | 'called';

export interface TableLiveState {
  status: TableLiveStatus;
  people: number;
  since?: string;
}
