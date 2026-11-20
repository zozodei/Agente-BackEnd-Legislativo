// Backtesting temporal de los modelos (punto 3 de la consigna).
//   node scripts/modelo/evaluar.mjs [variante=lsa] [modelos=base,logistica,gbdt]
// variante de similitud: lsa (producción) | minilm | minilm_hibrido | sin_similitud
// Escribe data/modelo/evaluacion/<variante>.json
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DIR_MODELO, DIR_DATASET, leerJsonGz, existe } from '../dataset/comun.mjs';
import { Historia, CLASES, diaDe } from '../../src/prediccion/historia.js';
import { NOMBRES_FEATURES, N_FEATURES } from '../../src/prediccion/features.js';
import { softmax, aplicarPosturaDeclarada } from '../../src/prediccion/modelo.js';
import { construirFilas, mayoriasReales } from './filas.mjs';
import {
  entrenarLogistica,
  entrenarGbdt,
  calibrarTemperatura,
  logits,
  metricas,
  K,
} from './aprendizaje.mjs';

export const CORTES = {
  entrenamientoDesde: '2008-01-01',
  validacionDesde: '2023-01-01',
  pruebaDesde: '2024-07-01',
  pruebaHasta: '2026-12-31',
};

const variante = process.argv[2] ?? 'lsa';
const pedidos = (process.argv[3] ?? 'base,logistica,gbdt').split(',');

const t0 = Date.now();
const art = leerJsonGz(join(DIR_MODELO, 'historia.json.gz'));
if (variante !== 'lsa') {
  const minilm = existe(join(DIR_DATASET, 'embeddings_minilm.json.gz'))
    ? leerJsonGz(join(DIR_DATASET, 'embeddings_minilm.json.gz'))
    : null;
  for (const v of art.votaciones) {
    if (variante === 'sin_similitud') v.emb = null;
    else if (variante === 'minilm') v.emb = { vector: minilm[v.id], captura: 1, disperso: [] };
    else if (variante === 'minilm_hibrido')
      v.emb = { vector: minilm[v.id], captura: 1, disperso: v.emb.disperso };
  }
  if (variante === 'minilm') {
    // con disperso vacío la similitud híbrida queda en 0.5·coseno: se reescala a coseno puro
    for (const v of art.votaciones) v.emb.vector = v.emb.vector.map((x) => x * Math.SQRT2);
  }
}
const historia = new Historia(art);
console.log(`historia cargada (${variante}) en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const d = (f) => diaDe(f);
const armar = (desde, hasta, supuestos = 'ninguno') => {
  const t = Date.now();
  const r = construirFilas(historia, { desdeDia: d(desde), hastaDia: d(hasta), supuestos });
  console.log(
    `  filas ${desde}→${hasta} [${supuestos}]: ${r.y.length} (${((Date.now() - t) / 1000).toFixed(1)} s)`,
  );
  return r;
};
const ent = armar(CORTES.entrenamientoDesde, CORTES.validacionDesde, 'dropout');
const val = armar(CORTES.validacionDesde, CORTES.pruebaDesde, 'ninguno');
const pru = armar(CORTES.pruebaDesde, CORTES.pruebaHasta, 'ninguno');
// Escenarios con supuestos declarados (se reportan aparte: NO son predicción pura).
const pruOfi = armar(CORTES.pruebaDesde, CORTES.pruebaHasta, 'oficialismo');
const pruBloques = armar(CORTES.pruebaDesde, CORTES.pruebaHasta, 'bloques');

const col = (nombre) => NOMBRES_FEATURES.indexOf(nombre);
const D = N_FEATURES;

// Subconjuntos de prueba: todas, proyectos "en general" y mociones.
function subconjuntos(conj) {
  const general = [];
  const mociones = [];
  conj.filas.forEach((f, i) => {
    const v = historia.votaciones[f.iv];
    if (v.esGeneral && v.tipo === 'proyecto') general.push(i);
    if (v.tipo === 'mocion') mociones.push(i);
  });
  return { todas: null, proyectosEnGeneral: general, mociones };
}

function evaluarProbs(P, conj, nombre) {
  const subs = subconjuntos(conj);
  const res = {};
  for (const [clave, idx] of Object.entries(subs)) {
    const sel = idx ?? conj.filas.map((_, i) => i);
    res[clave] = metricas(
      sel.map((i) => P[i]),
      Uint8Array.from(sel, (i) => conj.y[i]),
      CLASES,
    );
  }
  // Nivel votación (proyectos en general): conteos esperados y resultado.
  const porVot = [];
  for (const [iv, { inicio, fin }] of conj.porVotacion) {
    const v = historia.votaciones[iv];
    if (!(v.esGeneral && v.tipo === 'proyecto')) continue;
    const esperado = [0, 0, 0, 0];
    const argmax = [0, 0, 0, 0];
    const real = [0, 0, 0, 0];
    for (let i = inicio; i < fin; i++) {
      for (let k = 0; k < K; k++) esperado[k] += P[i][k];
      argmax[P[i].indexOf(Math.max(...P[i]))]++;
      real[conj.y[i]]++;
    }
    porVot.push({ iv, id: v.id, fecha: v.fecha, titulo: v.titulo, esperado, argmax, real });
  }
  const mae = [0, 1, 2, 3].map(
    (k) =>
      porVot.reduce((s, x) => s + Math.abs(x.esperado[k] - x.real[k]), 0) / (porVot.length || 1),
  );
  const aciertoResultado = porVot.filter(
    (x) => x.esperado[0] > x.esperado[1] === x.real[0] > x.real[1],
  ).length;
  const divididas = porVot.filter((x) => x.real[1] >= 0.2 * (x.real[0] + x.real[1]));
  const aciertoDivididas = divididas.filter(
    (x) => x.esperado[0] > x.esperado[1] === x.real[0] > x.real[1],
  ).length;
  const maeNegDivididas =
    divididas.reduce((s, x) => s + Math.abs(x.esperado[1] - x.real[1]), 0) /
    (divididas.length || 1);
  console.log(
    `${nombre.padEnd(28)} acc ${(res.todas.accuracy * 100).toFixed(1)}%  F1m ${res.todas.f1Macro.toFixed(3)}  ` +
      `logloss ${res.todas.logloss.toFixed(3)}  ECE ${res.todas.ece.toFixed(3)} | proyectos: acc ${(res.proyectosEnGeneral.accuracy * 100).toFixed(1)}% ` +
      `F1m ${res.proyectosEnGeneral.f1Macro.toFixed(3)} | resultado ${aciertoResultado}/${porVot.length} (divididas ${aciertoDivididas}/${divididas.length}) ` +
      `MAE A/N/Ab/Au ${mae.map((x) => x.toFixed(1)).join('/')}`,
  );
  return {
    ...res,
    votaciones: {
      n: porVot.length,
      maeConteo: Object.fromEntries(CLASES.map((c, k) => [c, mae[k]])),
      aciertoResultado,
      divididas: {
        n: divididas.length,
        aciertoResultado: aciertoDivididas,
        maeNegativos: maeNegDivididas,
      },
      detalle: porVot.map(({ iv: _iv, ...x }) => x),
    },
  };
}

const resultados = {
  variante,
  cortes: CORTES,
  filas: { entrenamiento: ent.y.length, validacion: val.y.length, prueba: pru.y.length },
  modelos: {},
};

// ------------------------------------------------------------- líneas de base
if (pedidos.includes('base')) {
  const frec = [0, 0, 0, 0];
  for (const c of ent.y) frec[c]++;
  const prior = frec.map((f) => f / ent.y.length);
  resultados.modelos.constante = evaluarProbs(
    pru.filas.map(() => prior),
    pru,
    'a0) constante (frecuencias)',
  );

  // a) "vota como la mayoría de su bloque": el bloque se estima con cómo votaron sus
  // integrantes en las votaciones más parecidas (lo único disponible antes de votar).
  const ia = col('blo_sim_A');
  const prediccionBloque = (conj, i) => {
    const x = conj.X.subarray(i * D, (i + 1) * D);
    const tres = [x[ia], x[ia + 1], x[ia + 2]];
    return tres.indexOf(Math.max(...tres));
  };
  // probabilidad asignada a la clase predicha: acierto observado en entrenamiento
  let aciertos = 0;
  for (let i = 0; i < ent.y.length; i++) if (prediccionBloque(ent, i) === ent.y[i]) aciertos++;
  const q = aciertos / ent.y.length;
  const probsDe = (pred) => [0, 1, 2, 3].map((k) => (k === pred ? q : (1 - q) / 3));
  resultados.modelos.mayoriaBloque = evaluarProbs(
    pru.filas.map((_, i) => probsDe(prediccionBloque(pru, i))),
    pru,
    'a) mayoría del bloque',
  );

  // a*) Techo de referencia (NO realizable): mayoría real del bloque en esa misma votación.
  const cacheMay = new Map();
  const Porc = pru.filas.map((f) => {
    if (!cacheMay.has(f.iv)) cacheMay.set(f.iv, mayoriasReales(historia, f.iv));
    const m = cacheMay.get(f.iv).get(f.grupo);
    return probsDe(m ?? 0);
  });
  resultados.modelos.oraculoBloque = evaluarProbs(Porc, pru, 'a*) oráculo bloque (techo)');
}

// Supuesto declarado aplicado como actualización bayesiana con la disciplina (lo que usa el motor).
function conSupuestoBayes(conj, P) {
  const [cOfi, cDecl, cDisc, cEsOfi] = [
    'decl_ofi',
    'decl_bloque_A',
    'disciplina',
    'es_oficialista',
  ].map(col);
  return P.map((p, i) => {
    const x = conj.X.subarray(i * D, (i + 1) * D);
    let declarado = [0, 1, 2].find((c) => x[cDecl + c] === 1);
    if (declarado === undefined && x[cEsOfi] === 1 && x[cOfi] !== 0)
      declarado = x[cOfi] > 0 ? 0 : 1;
    return aplicarPosturaDeclarada(p, declarado ?? null, x[cDisc]);
  });
}

// ------------------------------------------------------------- modelos estadísticos
function entrenarYEvaluar(nombre, entrenar) {
  const t = Date.now();
  const modelo = entrenar();
  const Zv = logits(modelo, val.X, D);
  modelo.temperatura = calibrarTemperatura(Zv, val.y);
  const Zp = logits(modelo, pru.X, D);
  const P = Zp.map((z) => softmax(z, modelo.temperatura));
  const r = evaluarProbs(P, pru, `${nombre} (T=${modelo.temperatura.toFixed(2)})`);
  for (const [clave, conj] of [
    ['conOficialismoDeclarado', pruOfi],
    ['conBloquesDeclarados', pruBloques],
  ]) {
    const Pc = logits(modelo, conj.X, D).map((z) => softmax(z, modelo.temperatura));
    r[clave] = evaluarProbs(Pc, conj, `   └ ${clave}`);
    r[`${clave}Bayes`] = evaluarProbs(conSupuestoBayes(conj, Pc), conj, `   └ ${clave} + bayes`);
  }
  r.segundosEntrenamiento = (Date.now() - t) / 1000;
  r.temperatura = modelo.temperatura;
  return { r, modelo };
}

if (pedidos.includes('logistica')) {
  const { r, modelo } = entrenarYEvaluar('b) regresión logística', () =>
    entrenarLogistica(ent.X, ent.y, D, { lambda: 1e-4, epocas: 20 }),
  );
  resultados.modelos.logistica = r;
  // importancia aproximada: |peso estandarizado| máximo entre clases
  resultados.importanciaLogistica = NOMBRES_FEATURES.map((nombre, j) => ({
    nombre,
    peso: Math.max(...modelo.W.map((w) => Math.abs(w[j]))),
  }))
    .sort((a, b) => b.peso - a.peso)
    .slice(0, 20);
}
if (pedidos.includes('gbdt')) {
  const { r, modelo } = entrenarYEvaluar('b) gradient boosting', () =>
    entrenarGbdt(ent.X, ent.y, D, {
      rondas: 120,
      tasa: 0.12,
      profundidad: 5,
      minHoja: 100,
      submuestra: 0.35,
      columnas: 0.7,
    }),
  );
  resultados.modelos.gbdt = r;
  // importancia: cantidad de cortes por feature
  const usos = new Array(D).fill(0);
  for (const ronda of modelo.arboles)
    for (const arbol of ronda) for (const nd of arbol) if (nd.f !== undefined) usos[nd.f]++;
  resultados.importanciaGbdt = NOMBRES_FEATURES.map((nombre, j) => ({ nombre, cortes: usos[j] }))
    .sort((a, b) => b.cortes - a.cortes)
    .slice(0, 20);
}

const dir = join(DIR_MODELO, 'evaluacion');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `${variante}.json`), JSON.stringify(resultados, null, 1));
console.log(
  `listo en ${((Date.now() - t0) / 1000).toFixed(0)} s → data/modelo/evaluacion/${variante}.json`,
);
