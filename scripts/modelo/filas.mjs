// Arma la matriz de entrenamiento/evaluación: una fila por (votación, diputado en la Cámara).
// Las features de cada votación se calculan solo con información de días anteriores.
import { calcularFeatures, N_FEATURES } from '../../src/prediccion/features.js';
import { COD, mayoriaDe } from '../../src/prediccion/historia.js';

/** Contexto de predicción de una votación histórica (lo que se sabría antes de votar). */
export function contextoDeVotacion(historia, iv) {
  const v = historia.votaciones[iv];
  let solicitante = null;
  if ((v.solicitantePersona ?? null) !== null) {
    const { p, g } = historia.votos[iv];
    const k = p.indexOf(v.solicitantePersona);
    if (k >= 0) solicitante = { persona: v.solicitantePersona, grupo: g[k] };
  }
  return {
    dia: v.dia,
    rep: v.emb,
    tipo: v.tipo,
    dictamen: v.dictamen,
    origenSenado: v.origenSenado,
    esGeneral: v.esGeneral,
    tema: v.tema,
    solicitante,
  };
}

export function sujetosDeVotacion(historia, iv) {
  const { p, v, g, pr } = historia.votos[iv];
  const sujetos = [];
  const etiquetas = [];
  for (let k = 0; k < p.length; k++) {
    if (v[k] === COD.PRESIDENTE) continue;
    sujetos.push({
      persona: p[k],
      grupo: g[k],
      bloqueNombre: historia.bloques[g[k]] ?? '',
      provincia: pr[k],
    });
    etiquetas.push(v[k]);
  }
  return { sujetos, etiquetas };
}

/**
 * @returns {{ X: Float32Array, y: Uint8Array, filas: {iv:number, persona:number, grupo:number}[], porVotacion: Map }}
 */
/**
 * supuestos: 'ninguno' (predicción pura), 'oficialismo' (se declara la postura real del oficialismo),
 * 'bloques' (se declaran la del oficialismo y la de cada bloque) o 'dropout' (entrenamiento:
 * al azar, para que el modelo funcione con y sin supuestos).
 */
export function construirFilas(
  historia,
  { desdeDia, hastaDia, filtro = () => true, log = false, supuestos = 'ninguno', semilla = 11 },
) {
  let a = semilla >>> 0;
  const azar = () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
  const bloquesX = [];
  const ys = [];
  const filas = [];
  const porVotacion = new Map();
  let procesadas = 0;
  for (let iv = 0; iv < historia.votaciones.length; iv++) {
    const v = historia.votaciones[iv];
    if (v.dia < desdeDia || v.dia >= hastaDia || !filtro(v)) continue;
    const ctx = contextoDeVotacion(historia, iv);
    const conSupuestos = supuestos === 'dropout' ? azar() < 0.5 : supuestos !== 'ninguno';
    if (conSupuestos) {
      const declararOfi = supuestos !== 'dropout' || azar() < 0.6;
      if (declararOfi && (v.ofi === 0 || v.ofi === 1)) ctx.posturaOficialismo = v.ofi;
      if (supuestos === 'bloques' || supuestos === 'dropout') {
        ctx.posturasBloque = new Map();
        for (const [grupo, m] of mayoriasReales(historia, iv)) {
          if ((m ?? null) !== null && (supuestos === 'bloques' || azar() < 0.6))
            ctx.posturasBloque.set(grupo, m);
        }
      }
    }
    const { sujetos, etiquetas } = sujetosDeVotacion(historia, iv);
    const { X, vecinos } = calcularFeatures(historia, ctx, sujetos);
    const inicio = filas.length;
    X.forEach((x, k) => {
      bloquesX.push(x);
      ys.push(etiquetas[k]);
      filas.push({ iv, persona: sujetos[k].persona, grupo: sujetos[k].grupo });
    });
    // Mayoría real de cada bloque (para la línea de base "oráculo") y vecino más parecido.
    porVotacion.set(iv, { inicio, fin: filas.length, vecinos });
    if (log && ++procesadas % 250 === 0) console.log(`  ${procesadas} votaciones…`);
  }
  const n = ys.length;
  const X = new Float32Array(n * N_FEATURES);
  bloquesX.forEach((x, i) => X.set(x, i * N_FEATURES));
  return { X, y: Uint8Array.from(ys), filas, porVotacion };
}

/** Mayoría (A/N/Abst) de cada bloque en una votación, según los votos reales. */
export function mayoriasReales(historia, iv) {
  const { v, g } = historia.votos[iv];
  const por = new Map();
  for (let k = 0; k < v.length; k++) {
    if (v[k] === COD.PRESIDENTE) continue;
    if (!por.has(g[k])) por.set(g[k], []);
    por.get(g[k]).push(v[k]);
  }
  return new Map([...por].map(([grupo, cods]) => [grupo, mayoriaDe(cods)]));
}
