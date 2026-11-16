import { calcularResultado } from '../resultado.js';

/**
 * Predictor SIMULADO. Devuelve datos de mentira con el mismo formato que el servicio
 * real (docs/prediccion.md) para poder probar la interfaz sin el modelo de ml/.
 * Es determinista: el mismo poroteo produce siempre la misma simulación.
 * Nunca se usa en producción (ver PREDICTOR_SIMULADO en config/env.js).
 */

const SIMULACIONES = 400;

function hash(texto) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Generador pseudoaleatorio reproducible (mulberry32). */
function generador(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const sigmoide = (x) => 1 / (1 + Math.exp(-x));
const redondear = (x) => Math.round(x * 1000) / 1000;

function cuantil(ordenados, q) {
  return ordenados[Math.min(ordenados.length - 1, Math.floor(q * ordenados.length))];
}

export function simularPrediccion({ proyecto, diputados }) {
  const semilla = hash(`${proyecto.id}|${proyecto.titulo}`);
  const rand = generador(semilla);

  const tendenciaBloque = new Map();
  for (const bloque of [...new Set(diputados.map((d) => d.bloque ?? ''))].sort()) {
    tendenciaBloque.set(bloque, -1.5 + rand() * 4);
  }

  const votos = diputados.map((d) => {
    const tendencia = tendenciaBloque.get(d.bloque ?? '');
    const z = tendencia + normal(rand) * 0.7;
    const presencia = Math.min(0.97, Math.max(0.6, (d.presentismo ?? 85) / 100));
    const abst = 0.03 + 0.05 * Math.exp(-z * z);
    const afi = (1 - abst) * sigmoide(z * 1.6);
    const p = {
      AFIRMATIVO: presencia * afi,
      NEGATIVO: presencia * (1 - abst - afi),
      ABSTENCION: presencia * abst,
      AUSENTE: 1 - presencia,
    };
    const [voto, confianza] = Object.entries(p).sort((a, b) => b[1] - a[1])[0];
    return {
      diputadoId: d.id,
      voto,
      probabilidades: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, redondear(v)])),
      confianza: redondear(confianza),
      justificacion: `SIMULACIÓN: no es una predicción real. Tendencia inventada para su bloque (${tendencia > 0.5 ? 'a favor' : tendencia < -0.5 ? 'en contra' : 'dividido'}).`,
      fuentes: [{ tipo: 'simulacion' }],
      tendencia,
    };
  });

  // Monte Carlo con un efecto común a la votación y otro por bloque: los votos no son
  // independientes, así que el intervalo sale ancho a propósito (igual que el modelo real).
  const afirmativos = [];
  const negativos = [];
  let aprobadas = 0;
  let conQuorum = 0;
  let divididas = 0;
  for (let s = 0; s < SIMULACIONES; s += 1) {
    const comun = normal(rand) * 0.6;
    const porBloque = new Map([...tendenciaBloque.keys()].map((b) => [b, normal(rand) * 0.8]));
    const muestra = diputados.map((d, i) => {
      const v = votos[i];
      if (rand() < v.probabilidades.AUSENTE) return 'AUSENTE';
      const z = v.tendencia + comun + porBloque.get(d.bloque ?? '');
      const r = rand();
      if (r < 0.04) return 'ABSTENCION';
      return r < 0.04 + 0.96 * sigmoide(z * 1.6) ? 'AFIRMATIVO' : 'NEGATIVO';
    });
    const resultado = calcularResultado(muestra, proyecto.tipoMayoria);
    afirmativos.push(resultado.conteo.AFIRMATIVO);
    negativos.push(resultado.conteo.NEGATIVO);
    if (resultado.resultado === 'APROBADO') aprobadas += 1;
    if (resultado.quorum.alcanzado) conQuorum += 1;
    if (resultado.conteo.NEGATIVO >= 30) divididas += 1;
  }
  afirmativos.sort((a, b) => a - b);
  negativos.sort((a, b) => a - b);

  const suma = (clase) =>
    Math.round(votos.reduce((acc, v) => acc + v.probabilidades[clase], 0) * 10) / 10;
  const probDividida = redondear(divididas / SIMULACIONES);

  return {
    modelo: {
      nombre: 'simulado',
      version: '0',
      variante: 'simulado',
      simulado: true,
      datosHasta: null,
    },
    tema: { valor: null, origen: 'desconocido' },
    votos: votos.map(({ tendencia: _t, ...v }) => v),
    resumen: {
      esperados: {
        afirmativos: suma('AFIRMATIVO'),
        negativos: suma('NEGATIVO'),
        abstenciones: suma('ABSTENCION'),
        ausentes: suma('AUSENTE'),
      },
      intervalo80: {
        afirmativos: [cuantil(afirmativos, 0.1), cuantil(afirmativos, 0.9)],
        negativos: [cuantil(negativos, 0.1), cuantil(negativos, 0.9)],
      },
      probAprobacion: redondear(aprobadas / SIMULACIONES),
      probQuorum: redondear(conQuorum / SIMULACIONES),
      probDividida,
      posibleDividida: probDividida >= 0.35,
    },
    advertencias: [
      'Predicción SIMULADA: sirve para probar la pantalla, no refleja ningún modelo real.',
    ],
  };
}
