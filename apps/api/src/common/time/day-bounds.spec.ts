import { dayBounds } from './day-bounds.js';

describe('dayBounds', () => {
  it('dia civil de São Paulo (UTC−3) vai de 03:00Z a 03:00Z do dia seguinte', () => {
    const { start, end } = dayBounds(new Date('2026-10-21T02:00:00Z'), 'America/Sao_Paulo'); // ainda é 20/10 às 23h local
    expect(start.toISOString()).toBe('2026-10-20T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-21T03:00:00.000Z');
    expect(dayBounds(new Date('2026-10-21T15:00:00Z'), 'America/Sao_Paulo').start.toISOString()).toBe('2026-10-21T03:00:00.000Z');
  });

  it('funciona em UTC e em fuso com horário de verão', () => {
    expect(dayBounds(new Date('2026-03-10T12:00:00Z'), 'UTC')).toEqual({ start: new Date('2026-03-10T00:00:00Z'), end: new Date('2026-03-11T00:00:00Z') });
    const ny = dayBounds(new Date('2026-03-08T18:00:00Z'), 'America/New_York'); // dia da troca para o verão: 23 h
    expect(ny.end.getTime() - ny.start.getTime()).toBe(23 * 3600_000);
  });
});
