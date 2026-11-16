import { beforeEach, describe, expect, it, vi } from 'vitest';

// Sin red ni Supabase: el poroteo, los diputados y el servicio Python son dobles.
vi.mock('../src/config/env.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, env: { ...real.env } };
});
vi.mock('../src/services/poroteos.service.js', () => ({ getPoroteo: vi.fn() }));
vi.mock('../src/services/diputados.service.js', () => ({ getAllDiputados: vi.fn() }));
vi.mock('../src/clients/predictor.client.js', () => ({ solicitarPrediccion: vi.fn() }));

const { env } = await import('../src/config/env.js');
const { getPoroteo } = await import('../src/services/poroteos.service.js');
const { getAllDiputados } = await import('../src/services/diputados.service.js');
const { solicitarPrediccion } = await import('../src/clients/predictor.client.js');
const { predecirPoroteo, modoPredictor } = await import('../src/services/prediccion.service.js');
const { simularPrediccion } = await import('../src/services/prediccion/simulador.js');

const USER = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const BLOQUES = ['A', 'B', 'C'];
const diputados = Array.from({ length: 257 }, (_, i) => ({
  id: i + 1,
  apellido: `Apellido${i}`,
  nombre: 'Nombre',
  distrito: 'CABA',
  bloque: BLOQUES[i % 3],
  personaId: 1000 + i,
  presentismo: 90,
}));
const poroteo = {
  id: ID,
  titulo: 'Ley de prueba',
  descripcion: null,
  textoProyecto: 'Artículo 1',
  autor: null,
  tipoMayoria: 'simple',
  camara: 'diputados',
  version: 3,
  permisos: { editar: true },
};

function respuestaServicio(votos) {
  return {
    modelo: { nombre: 'poroteo-ml', version: '1', variante: 'solo_tema', datosHasta: '2026-11-02' },
    tema: { valor: 'ECONOMIA', origen: 'titulo' },
    votos,
    resumen: {
      esperados: { afirmativos: 1, negativos: 0, abstenciones: 0, ausentes: 0 },
      intervalo80: { afirmativos: [0, 2], negativos: [0, 1] },
      probAprobacion: 0.8,
      probQuorum: 0.9,
      probDividida: 0.1,
      posibleDividida: false,
    },
    advertencias: [],
  };
}
const voto = (diputadoId, extra = {}) => ({
  diputadoId,
  voto: 'AFIRMATIVO',
  probabilidades: { AFIRMATIVO: 0.7, NEGATIVO: 0.2, ABSTENCION: 0.05, AUSENTE: 0.05 },
  confianza: 0.7,
  justificacion: 'Historial a favor en el tema',
  fuentes: [{ tipo: 'historial_tema', votaciones: 3 }],
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  env.PREDICTOR_URL = '';
  env.PREDICTOR_SIMULADO = true;
  getPoroteo.mockResolvedValue(poroteo);
  getAllDiputados.mockResolvedValue(diputados);
});

describe('modo del predictor', () => {
  it('usa el servicio si hay URL, si no el simulado, y se apaga si se desactiva', () => {
    expect(modoPredictor()).toBe('simulado');
    env.PREDICTOR_URL = 'http://localhost:8000';
    expect(modoPredictor()).toBe('servicio');
    env.PREDICTOR_URL = '';
    env.PREDICTOR_SIMULADO = false;
    expect(modoPredictor()).toBe('apagado');
  });

  it('apagado responde 503 sin consultar el poroteo', async () => {
    env.PREDICTOR_SIMULADO = false;
    await expect(predecirPoroteo(ID, USER)).rejects.toMatchObject({ status: 503 });
    expect(getPoroteo).not.toHaveBeenCalled();
  });
});

describe('predecirPoroteo', () => {
  it('exige permiso de edición', async () => {
    getPoroteo.mockResolvedValue({ ...poroteo, permisos: { editar: false } });
    await expect(predecirPoroteo(ID, USER)).rejects.toMatchObject({ status: 403 });
  });

  it('propaga el 404 de membresía', async () => {
    getPoroteo.mockRejectedValue(Object.assign(new Error('no'), { status: 404 }));
    await expect(predecirPoroteo(ID, USER)).rejects.toMatchObject({ status: 404 });
  });

  it('con el simulado devuelve los 257 votos y lo marca como simulado', async () => {
    const r = await predecirPoroteo(ID, USER);
    expect(r.votos).toHaveLength(257);
    expect(r.modelo.simulado).toBe(true);
    expect(r.version).toBe(3);
    expect(r.advertencias.join(' ')).toMatch(/SIMULADA/);
    expect(solicitarPrediccion).not.toHaveBeenCalled();
  });

  it('envía proyecto y diputados al servicio y descarta IDs ajenos o repetidos', async () => {
    env.PREDICTOR_URL = 'http://localhost:8000';
    solicitarPrediccion.mockResolvedValue(respuestaServicio([voto(1), voto(1), voto(9999)]));
    const r = await predecirPoroteo(ID, USER);
    const entrada = solicitarPrediccion.mock.calls[0][0];
    expect(entrada.proyecto).toMatchObject({
      id: ID,
      titulo: 'Ley de prueba',
      texto: 'Artículo 1',
    });
    expect(entrada.diputados).toHaveLength(257);
    expect(r.votos.map((v) => v.diputadoId)).toEqual([1]);
    expect(r.advertencias.join(' ')).toMatch(/descartaron 2/);
    expect(r.advertencias.join(' ')).toMatch(/256 diputados quedaron sin predicción/);
  });

  it('rechaza formatos inválidos del servicio con 502', async () => {
    env.PREDICTOR_URL = 'http://localhost:8000';
    solicitarPrediccion.mockResolvedValue(
      respuestaServicio([
        voto(1, { probabilidades: { AFIRMATIVO: 0.9, NEGATIVO: 0.9, ABSTENCION: 0, AUSENTE: 0 } }),
      ]),
    );
    await expect(predecirPoroteo(ID, USER)).rejects.toMatchObject({ status: 502 });
    solicitarPrediccion.mockResolvedValue(respuestaServicio([voto(1, { voto: 'INDEFINIDO' })]));
    await expect(predecirPoroteo(ID, USER)).rejects.toMatchObject({ status: 502 });
  });

  it('no acepta una simulación desde el servicio real', async () => {
    env.PREDICTOR_URL = 'http://localhost:8000';
    const r = respuestaServicio([voto(1)]);
    r.modelo.simulado = true;
    solicitarPrediccion.mockResolvedValue(r);
    await expect(predecirPoroteo(ID, USER)).rejects.toMatchObject({ status: 502 });
  });
});

describe('simulador', () => {
  const entrada = { proyecto: { ...poroteo }, diputados };

  it('es determinista y cambia según el proyecto', () => {
    const a = simularPrediccion(entrada);
    expect(simularPrediccion(entrada)).toEqual(a);
    const b = simularPrediccion({ ...entrada, proyecto: { ...poroteo, titulo: 'Otra ley' } });
    expect(b.votos.map((v) => v.voto)).not.toEqual(a.votos.map((v) => v.voto));
  });

  it('respeta el contrato: probabilidades que suman 1, voto = clase más probable', () => {
    const r = simularPrediccion(entrada);
    for (const v of r.votos) {
      const p = v.probabilidades;
      expect(p.AFIRMATIVO + p.NEGATIVO + p.ABSTENCION + p.AUSENTE).toBeCloseTo(1, 2);
      expect(Math.max(...Object.values(p))).toBeCloseTo(p[v.voto], 5);
    }
    const { intervalo80, esperados, probAprobacion } = r.resumen;
    expect(intervalo80.afirmativos[0]).toBeLessThanOrEqual(intervalo80.afirmativos[1]);
    expect(esperados.afirmativos + esperados.negativos).toBeLessThanOrEqual(257);
    expect(probAprobacion).toBeGreaterThanOrEqual(0);
    expect(probAprobacion).toBeLessThanOrEqual(1);
  });
});
