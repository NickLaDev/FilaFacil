import { activeRange, hoursLabel, localClock } from './opening-hours.js';

const NIGHT = [{ weekday: 5, opensAt: 17 * 60, closesAt: 2 * 60 }]; // sexta 17:00–02:00

describe('horário de funcionamento', () => {
  it('usa o fuso do estabelecimento, não o do servidor', () => {
    // 2026-10-03T01:30Z = sexta 22:30 em São Paulo (UTC-3)
    expect(localClock(new Date('2026-10-03T01:30:00Z'), 'America/Sao_Paulo')).toEqual({ weekday: 5, minutes: 22 * 60 + 30 });
  });

  it('considera aberta a faixa que atravessa a meia-noite no dia seguinte', () => {
    expect(activeRange(NIGHT, { weekday: 5, minutes: 23 * 60 })).not.toBeNull();
    expect(activeRange(NIGHT, { weekday: 6, minutes: 60 })).not.toBeNull();
    expect(activeRange(NIGHT, { weekday: 6, minutes: 2 * 60 })).toBeNull();
    expect(activeRange(NIGHT, { weekday: 5, minutes: 16 * 60 })).toBeNull();
  });

  it('descreve o horário do dia como o cliente vê', () => {
    expect(hoursLabel(NIGHT, { weekday: 5, minutes: 20 * 60 })).toBe('Hoje: 17:00–02:00');
    expect(hoursLabel(NIGHT, { weekday: 5, minutes: 10 * 60 })).toBe('Abre às 17:00');
    expect(hoursLabel(NIGHT, { weekday: 2, minutes: 10 * 60 })).toBe('Fechado hoje');
  });
});
