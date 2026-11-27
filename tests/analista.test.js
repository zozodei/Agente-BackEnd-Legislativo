import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/clients/llm.client.js', () => ({
  llmDisponible: () => true,
  consultarEstructurado: vi.fn(async () => ({
    modelo: 'claude-opus-5-5',
    datos: {
      bloques: [
        {
          bloque: 'La Libertad Avanza',
          AFIRMATIVO: 0.1,
          NEGATIVO: 0.85,
          ABSTENCION: 0.05,
          razon: 'El proyecto amplía el gasto que el bloque objetó en votaciones afines.',
        },
        {
          bloque: 'Unión por la Patria',
          AFIRMATIVO: 0.9,
          NEGATIVO: 0.05,
          ABSTENCION: 0.05,
          razon: 'Sus integrantes votaron a favor de proyectos parecidos.',
        },
      ],
      divideALaCamara: 0.8,
      resumen: 'Proyecto de financiamiento con posturas opuestas entre oficialismo y oposición.',
    },
  })),
}));
vi.mock('../src/repositories/explicaciones.repository.js', () => ({
  fetchExplicaciones: vi.fn(async () => new Map()),
  guardarExplicaciones: vi.fn(async () => {}),
}));

const { aplicarPosturaBlanda, aplicarPosturaDeclarada } =
  await import('../src/prediccion/modelo.js');
const { analizarBloques } = await import('../src/services/analistaBloques.service.js');
const { MotorPrediccion } = await import('../src/prediccion/motor.js');
const { readFileSync } = await import('node:fs');
const { gunzipSync } = await import('node:zlib');

describe('postura incierta del bloque', () => {
  it('con certeza es igual a la postura declarada', () => {
    const p = [0.7, 0.2, 0.02, 0.08];
    const a = aplicarPosturaBlanda(p, [0, 1, 0], 0.95);
    const b = aplicarPosturaDeclarada(p, 1, 0.95);
    a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 10));
  });
  it('mueve la probabilidad sin tocar la ausencia', () => {
    const p = [0.7, 0.2, 0.02, 0.08];
    const r = aplicarPosturaBlanda(p, [0.2, 0.8, 0], 0.95);
    expect(r[1]).toBeGreaterThan(p[1]);
    expect(r[3]).toBe(p[3]);
    expect(r.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10);
  });
});

describe('analista de bloques', () => {
  const raw = (t) =>
    JSON.parse(gunzipSync(readFileSync(new URL(`../data/raw/${t}.json.gz`, import.meta.url))));
  const bloques = new Map(raw('bloques').map((b) => [b.id, b.nombre]));
  const diputados = raw('diputados').map((d) => ({
    id: d.id,
    personaId: d.cv_persona_id,
    bloque: bloques.get(d.bloque_id),
    nombreCompleto: d.apellido,
  }));
  const motor = MotorPrediccion.cargar();
  const entrada = { titulo: 'Ley de financiamiento universitario' };

  it('asocia cada bloque y sus probabilidades, y el motor las reparte por diputado', async () => {
    const base = motor.predecir(entrada, diputados);
    const a = await analizarBloques(entrada, base, diputados);
    expect(a.bloques['LA LIBERTAD AVANZA'].postura).toBe('NEGATIVO');
    const r = motor.predecir(
      {
        ...entrada,
        posturasBlandas: Object.fromEntries(
          Object.entries(a.bloques).map(([b, x]) => [b, x.probabilidades]),
        ),
        analisisBloques: a.bloques,
      },
      diputados,
    );
    const lla = r.predicciones.filter((_, i) => diputados[i].bloque === 'LA LIBERTAD AVANZA');
    expect(lla.filter((p) => p.voto === 'NEGATIVO').length / lla.length).toBeGreaterThan(0.8);
    expect(lla[0].explicacion).toMatch(/análisis de IA del proyecto estima/);
  });
});
