import { describe, expect, it } from 'vitest';
import { conteoDe, toVotacionDTO } from '../src/services/votaciones.service.js';

describe('conteo de una votación', () => {
  it('usa conteo_coaliciones.tot porque las columnas de cv_votaciones vienen corridas', () => {
    // IVE 14/06/2018 (votación 1516): fue 129 a 125, la tabla dice 125/1/1/0.
    const fila = {
      afirmativos: 125,
      negativos: 1,
      abstenciones: 1,
      ausentes: 0,
      conteo_coaliciones: { tot: [129, 125, 1, 1] },
    };
    expect(conteoDe(fila)).toEqual({
      afirmativos: 129,
      negativos: 125,
      abstenciones: 1,
      ausentes: 1,
    });
    expect(toVotacionDTO({ id: 1516, ...fila }).conteo.afirmativos).toBe(129);
  });

  it('sin conteo_coaliciones usa las columnas', () => {
    expect(conteoDe({ afirmativos: 3, negativos: 2, abstenciones: 1, ausentes: 0 })).toEqual({
      afirmativos: 3,
      negativos: 2,
      abstenciones: 1,
      ausentes: 0,
    });
  });
});
