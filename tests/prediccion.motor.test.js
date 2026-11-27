// Motor de predicción con los artefactos reales de data/modelo (sin red).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { MotorPrediccion, nivelDeConfianza } from '../src/prediccion/motor.js';
import { buscarVecinos, calcularFeatures, N_FEATURES } from '../src/prediccion/features.js';
import { diaDe } from '../src/prediccion/historia.js';
import { clasificarTema, analizarTitulo, extraerSolicitante } from '../src/prediccion/proyecto.js';
import { explicarConPlantilla, nombreBloque } from '../src/prediccion/explicacion.js';
import { validarTexto, datosParaLlm } from '../src/services/explicaciones.service.js';
import { gobiernoEn } from '../src/prediccion/gobiernos.js';

const raw = (t) =>
  JSON.parse(gunzipSync(readFileSync(new URL(`../data/raw/${t}.json.gz`, import.meta.url))));
const motor = MotorPrediccion.cargar();
const bloques = new Map(raw('bloques').map((b) => [b.id, b.nombre]));
const diputados = raw('diputados').map((d) => ({
  id: d.id,
  personaId: d.cv_persona_id,
  bloque: bloques.get(d.bloque_id),
  nombreCompleto: `${d.apellido}, ${d.nombre}`,
}));

describe('análisis del texto', () => {
  it('clasifica temas y rasgos del título', () => {
    expect(clasificarTema('Ley de financiamiento universitario')).toBe('educacion');
    expect(clasificarTema('MOCIÓN DE APARTAMIENTO DE REGLAMENTO')).toBe('procedimiento');
    expect(
      analizarTitulo('O.D. 6 - LEY DE MODERNIZACIÓN LABORAL. DICT. DE MAY. VOT. EN GRAL.'),
    ).toMatchObject({ tipo: 'proyecto', dictamen: 'mayoria' });
    expect(extraerSolicitante('MOCIÓN SOLICITADA POR LA DIP. GIUDICI, SILVANA.')).toMatchObject({
      apellido: 'giudici',
      nombre: 'silvana',
    });
  });

  it('identifica el gobierno vigente', () => {
    expect(gobiernoEn('2018-06-14').id).toBe('macri');
    expect(gobiernoEn('2026-11-20').id).toBe('milei');
  });
});

describe('anti-fuga temporal', () => {
  it('los vecinos son siempre de días anteriores', () => {
    const h = motor.historia;
    const iv = h.indiceVotacion.get(1516); // IVE 14/06/2018
    const v = h.votaciones[iv];
    const vecinos = buscarVecinos(h, v.emb, v.dia);
    expect(vecinos.length).toBeGreaterThan(0);
    for (const x of vecinos) expect(h.votaciones[x.iv].dia).toBeLessThan(v.dia);
    expect(vecinos.some((x) => h.votaciones[x.iv].id === 1516)).toBe(false);
  });

  it('las ventanas de historial no incluyen la fecha de corte', () => {
    const h = motor.historia;
    const p = h.indicePersona.get(177);
    const dia = diaDe('2025-01-01');
    const r = h.resumenPersona(p, dia - 730, dia);
    const [i, j, l] = h.rango(p, dia - 730, dia);
    expect(r.total).toBe(j - i);
    if (j < l.dia.length) expect(l.dia[j]).toBeGreaterThanOrEqual(dia);
  });
});

describe('predicción de un proyecto nuevo', () => {
  const r = motor.predecir(
    { titulo: 'Financiamiento de las universidades nacionales y salarios docentes' },
    diputados,
  );

  it('predice a los 257 con probabilidades válidas', () => {
    expect(r.predicciones).toHaveLength(257);
    for (const p of r.predicciones) {
      const suma = Object.values(p.probabilidades).reduce((a, b) => a + b, 0);
      expect(suma).toBeCloseTo(1, 2);
      expect(['alta', 'media', 'baja']).toContain(p.nivelConfianza);
      expect(p.confianza).toBe(Math.round(p.probabilidades[p.voto] * 1000) / 1000);
    }
    const esperados = Object.values(r.resumen.esperados).reduce((a, b) => a + b, 0);
    expect(esperados).toBeCloseTo(257, 0);
  });

  it('encuentra votaciones parecidas y las cita', () => {
    expect(r.similares[0].titulo).toMatch(/FINANCIAMIENTO/i);
    const conVotos = r.predicciones.find((p) => p.factores.similares.some((s) => s.voto));
    expect(conVotos.explicacion).toMatch(/«.+» \(\d{1,2}\/\d{1,2}\/\d{4}/);
  });

  it('explicaciones de 2 a 4 oraciones, sin números fuera de los datos', () => {
    for (const p of r.predicciones) {
      const oraciones = p.explicacion.split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ])/);
      expect(oraciones.length).toBeGreaterThanOrEqual(2);
      expect(oraciones.length).toBeLessThanOrEqual(4);
    }
  });

  it('el mismo tono para todos los bloques (sin adjetivos valorativos)', () => {
    const prohibidas =
      /\b(corrupt|kirchnerista|gorila|populist|extremist|radicalizad|traidor|mentir|vendepatria)/i;
    for (const p of r.predicciones) expect(p.explicacion).not.toMatch(prohibidas);
  });

  it('acepta supuestos del escenario y los refleja', () => {
    const conSupuesto = motor.predecir(
      {
        titulo: 'Financiamiento universitario',
        posturasBloque: { 'UNIÓN POR LA PATRIA': 'NEGATIVO' },
      },
      diputados,
    );
    const uxp = conSupuesto.predicciones.filter(
      (_, i) => diputados[i].bloque === 'UNIÓN POR LA PATRIA',
    );
    // Cada diputado sigue el supuesto según su disciplina: la gran mayoría pasa a negativo.
    expect(uxp.filter((p) => p.voto === 'NEGATIVO').length / uxp.length).toBeGreaterThan(0.7);
    expect(uxp[0].explicacion).toMatch(/El escenario supone/);
  });
});

describe('confianza y textos', () => {
  it('pocos datos siempre es confianza baja', () => {
    expect(nivelDeConfianza(0.95, true)).toBe('baja');
    expect(nivelDeConfianza(0.8, false)).toBe('alta');
    expect(nivelDeConfianza(0.6, false)).toBe('media');
    expect(nivelDeConfianza(0.4, false)).toBe('baja');
  });

  it('formatea nombres de bloque', () => {
    expect(nombreBloque('UNIÓN POR LA PATRIA')).toBe('Unión por la Patria');
    expect(nombreBloque('UCR - UNIÓN CÍVICA RADICAL')).toBe('UCR - Unión Cívica Radical');
  });

  it('el validador del LLM rechaza números inventados', () => {
    const r = motor.predecir({ titulo: 'Reforma laboral' }, diputados);
    const datos = datosParaLlm(r.predicciones[0].factores);
    const plantilla = explicarConPlantilla(r.predicciones[0].factores);
    expect(validarTexto(plantilla, datos)).toBe(true);
    expect(
      validarTexto('Se estima afirmativo. Votó a favor en 47 de 52 proyectos parecidos.', datos),
    ).toBe(false);
    expect(validarTexto('Una sola oración sin datos suficientes para explicar nada.', datos)).toBe(
      false,
    );
  });

  it('las features tienen la dimensión que espera el modelo', () => {
    const h = motor.historia;
    const { X } = calcularFeatures(
      h,
      { dia: diaDe('2026-11-20'), rep: motor.representacion({ titulo: 'x y z' }) },
      [{ persona: 0, grupo: 'a', bloqueNombre: 'A', provincia: 0 }],
    );
    expect(X[0]).toHaveLength(N_FEATURES);
    expect(motor.modelo.features).toHaveLength(N_FEATURES);
  });
});

describe('proyectos sin antecedentes', () => {
  const texto =
    'Regulación de la gestación por sustitución de vientres: derechos de la persona gestante y de los padres de intención';
  const r = motor.predecir({ titulo: texto }, diputados);

  it('detecta el tema, avisa y nunca marca predicciones firmes', () => {
    expect(r.proyecto.tema).toBe('derechos');
    expect(r.antecedentes.sinAntecedentes).toBe(true);
    expect(r.antecedentes.divididasDelTema.length).toBeGreaterThan(0);
    expect(r.resumen.nivelConfianza.alta).toBe(0);
  });

  it('el escenario "como las divididas del tema" divide la Cámara', () => {
    const e = motor.predecir({ titulo: texto, comoTemaDividido: true }, diputados);
    expect(e.supuestos.comoTemaDividido).toBe(true);
    expect(e.resumen.porVoto.NEGATIVO).toBeGreaterThan(60);
    expect(e.predicciones[0].explicacion).toMatch(/divididas del mismo tema/);
  });
});
