import { describe, expect, it } from 'vitest';
import { calcularResultado } from '../src/services/resultado.js';

const repeat = (voto, n) => Array.from({ length: n }, () => voto);

describe('calcularResultado', () => {
  it('sin votos asignados: sin quórum y todo en disputa', () => {
    const r = calcularResultado([]);
    expect(r.resultado).toBe('SIN_QUORUM');
    expect(r.enDisputa).toBe(257);
    expect(r.conteo.sinAsignar).toBe(257);
    expect(r.definido).toBe(false);
  });

  it('mayoría simple: aprueba si afirmativos > negativos con quórum', () => {
    const votos = [
      ...repeat('AFIRMATIVO', 130),
      ...repeat('NEGATIVO', 120),
      ...repeat('AUSENTE', 7),
    ];
    const r = calcularResultado(votos);
    expect(r.quorum.alcanzado).toBe(true);
    expect(r.resultado).toBe('APROBADO');
    expect(r.definido).toBe(true);
  });

  it('las abstenciones cuentan para el quórum pero no para la mayoría simple', () => {
    const votos = [
      ...repeat('AFIRMATIVO', 60),
      ...repeat('NEGATIVO', 59),
      ...repeat('ABSTENCION', 10),
      ...repeat('AUSENTE', 128),
    ];
    const r = calcularResultado(votos);
    expect(r.presentes).toBe(129);
    expect(r.resultado).toBe('APROBADO');
  });

  it('empate en mayoría simple → rechazado', () => {
    const votos = [...repeat('AFIRMATIVO', 128), ...repeat('NEGATIVO', 128), 'AUSENTE'];
    expect(calcularResultado(votos).resultado).toBe('RECHAZADO');
  });

  it('sin quórum aunque haya más afirmativos', () => {
    const votos = [...repeat('AFIRMATIVO', 100), ...repeat('AUSENTE', 157)];
    const r = calcularResultado(votos);
    expect(r.resultado).toBe('SIN_QUORUM');
    expect(r.quorum.faltan).toBe(29);
  });

  it('mayoría absoluta exige 129 afirmativos', () => {
    const votos = [
      ...repeat('AFIRMATIVO', 128),
      ...repeat('NEGATIVO', 10),
      ...repeat('AUSENTE', 119),
    ];
    expect(calcularResultado(votos, 'absoluta').resultado).toBe('RECHAZADO');
    expect(calcularResultado(votos, 'simple').resultado).toBe('APROBADO');
  });

  it('dos tercios de los presentes', () => {
    const votos = [
      ...repeat('AFIRMATIVO', 160),
      ...repeat('NEGATIVO', 90),
      ...repeat('AUSENTE', 7),
    ];
    const r = calcularResultado(votos, 'dos_tercios');
    expect(r.mayoria.requeridos).toBe(167);
    expect(r.resultado).toBe('RECHAZADO');
  });

  it('indefinidos dejan el resultado abierto si pueden darlo vuelta', () => {
    const votos = [
      ...repeat('AFIRMATIVO', 120),
      ...repeat('NEGATIVO', 115),
      ...repeat('INDEFINIDO', 22),
    ];
    const r = calcularResultado(votos);
    expect(r.resultado).toBe('APROBADO');
    expect(r.escenarios).toEqual({ mejorCaso: 'APROBADO', peorCaso: 'RECHAZADO' });
    expect(r.definido).toBe(false);
  });
});
