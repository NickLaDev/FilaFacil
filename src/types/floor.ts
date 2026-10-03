export type TableShape = 'round' | 'square' | 'rect';

export interface FloorTable {
  id: string;
  label: string;
  shape: TableShape;
  capacity: number;
  /** Posição do centro em % da área da planta (0–100). */
  x: number;
  y: number;
  /** Código único impresso no QR Code da mesa. */
  qrCode: string;
}

export interface TableMerge {
  id: string;
  tableIds: string[];
}

export interface FloorLayout {
  tables: FloorTable[];
  merges: TableMerge[];
  updatedAt: string;
}

export type TableLiveStatus = 'free' | 'occupied' | 'reserved' | 'called';

export interface TableLiveState {
  status: TableLiveStatus;
  people: number;
  since?: string;
}
