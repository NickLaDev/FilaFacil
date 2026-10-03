import type { FloorLayout, FloorTable, TableLiveState, TableShape } from '@/types/floor';

const table = (id: string, label: string, shape: TableShape, capacity: number, x: number, y: number, qrCode: string): FloorTable => ({
  id, label, shape, capacity, x, y, qrCode,
});

const seedDate = new Date().toISOString();

export const FLOOR_LAYOUTS: Record<string, FloorLayout> = {
  r1: {
    updatedAt: seedDate,
    merges: [],
    tables: [
      table('t1', 'Mesa 1', 'round', 2, 12, 18, 'MESTRE-1041'),
      table('t2', 'Mesa 2', 'round', 2, 30, 18, 'MESTRE-2087'),
      table('t3', 'Mesa 3', 'round', 2, 48, 18, 'MESTRE-3112'),
      table('t4', 'Mesa 4', 'round', 2, 66, 18, 'MESTRE-4250'),
      table('t5', 'Mesa 5', 'square', 4, 12, 48, 'MESTRE-5379'),
      table('t6', 'Mesa 6', 'square', 4, 30, 48, 'MESTRE-6403'),
      table('t7', 'Mesa 7', 'square', 4, 48, 48, 'MESTRE-7531'),
      table('t8', 'Mesa 8', 'square', 4, 66, 48, 'MESTRE-8664'),
      table('t9', 'Mesa 9', 'rect', 6, 16, 80, 'MESTRE-9718'),
      table('t10', 'Mesa 10', 'rect', 6, 42, 80, 'MESTRE-1095'),
      table('t11', 'Mesa 11', 'rect', 6, 68, 80, 'MESTRE-1126'),
      table('t12', 'Mesa 12', 'square', 4, 88, 30, 'MESTRE-1283'),
    ],
  },
  r3: {
    updatedAt: seedDate,
    merges: [],
    tables: [
      table('c1', 'Mesa 1', 'rect', 6, 30, 50, 'CANTINA-1201'),
      table('c2', 'Mesa 2', 'rect', 6, 70, 50, 'CANTINA-2302'),
    ],
  },
  r7: { updatedAt: seedDate, merges: [], tables: [] },
  r8: {
    updatedAt: seedDate,
    merges: [],
    tables: [
      table('x1', 'Mesa 1', 'round', 2, 25, 35, 'EXPRESS-1150'),
      table('x2', 'Mesa 2', 'round', 2, 50, 35, 'EXPRESS-2261'),
      table('x3', 'Mesa 3', 'square', 4, 25, 70, 'EXPRESS-3372'),
      table('x4', 'Mesa 4', 'square', 4, 50, 70, 'EXPRESS-4483'),
    ],
  },
};

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** Situação operacional das mesas (normalmente viria em tempo real do backend). */
export const TABLE_LIVE_STATES: Record<string, TableLiveState> = {
  t1: { status: 'free', people: 0 },
  t2: { status: 'occupied', people: 2, since: minutesAgo(42) },
  t3: { status: 'occupied', people: 2, since: minutesAgo(18) },
  t4: { status: 'reserved', people: 2, since: minutesAgo(5) },
  t5: { status: 'free', people: 0 },
  t6: { status: 'called', people: 3, since: minutesAgo(55) },
  t7: { status: 'occupied', people: 4, since: minutesAgo(25) },
  t8: { status: 'free', people: 0 },
  t9: { status: 'occupied', people: 6, since: minutesAgo(102) },
  t10: { status: 'free', people: 0 },
  t11: { status: 'reserved', people: 6, since: minutesAgo(3) },
  t12: { status: 'occupied', people: 3, since: minutesAgo(71) },
};
