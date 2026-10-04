import { estimateWaitMinutes, releasedTablesLabel } from './wait-estimate.js';

describe('estimativa da fila', () => {
  it('é imediata enquanto houver mesas livres compatíveis para os grupos à frente', () => {
    expect(estimateWaitMinutes(0, 1)).toBe(0);
    expect(estimateWaitMinutes(1, 2)).toBe(0);
  });

  it('soma um giro médio por grupo excedente', () => {
    expect(estimateWaitMinutes(0, 0)).toBe(12);
    expect(estimateWaitMinutes(3, 1)).toBe(36);
  });

  it('nomeia mesas liberadas juntas', () => {
    expect(releasedTablesLabel(['Mesa 3'])).toBe('Mesa 3');
    expect(releasedTablesLabel(['Mesa 3', 'Mesa 4'])).toBe('Mesas 3 + 4');
  });
});
