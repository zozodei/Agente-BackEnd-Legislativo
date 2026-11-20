// Representación de proyectos para buscar votaciones parecidas.
// TF-IDF sobre títulos/keywords + LSA (SVD truncada) → embedding denso de `dims` dimensiones.
// Es JS puro: el mismo código arma los vectores al entrenar y al predecir un proyecto nuevo.
import { normalizarTexto } from './proyecto.js';

const STOPWORDS = new Set(
  (
    'a al ante bajo con contra de del desde durante en entre hacia hasta mediante para por segun ' +
    'sin sobre tras y e o u ni que la las el los lo un una unos unas su sus se es son fue ser ' +
    'como mas pero sus este esta estos estas ese esa eso cual cuales donde cuando quien ' +
    'otro otra otros otras sus tambien muy ya le les nos ' +
    // ruido propio de los títulos de la HCDN
    'od o d dict dictamen may min vot gral grales part particular general generales votacion ' +
    'modif modificacion modificaciones proyecto proyectos ley leyes nacional nacion art arts ' +
    'articulo articulos inc expte exp expediente cuestiones conexas conexa sobre relativas ' +
    'relativa relativo creacion regimen sancion prov provincia rep republica argentina ' +
    'diputado diputada dip dips solicitado solicitada mocion apartamiento reglamento'
  ).split(' '),
);

/** Raíz aproximada en español (recorta sufijos frecuentes). */
export function raiz(palabra) {
  let p = palabra;
  for (const suf of [
    'aciones',
    'iciones',
    'amiento',
    'imiento',
    'mente',
    'acion',
    'icion',
    'ciones',
    'cion',
    'idad',
    'ales',
    'ores',
    'es',
    's',
  ]) {
    if (p.length - suf.length >= 4 && p.endsWith(suf)) {
      p = p.slice(0, -suf.length);
      break;
    }
  }
  return p;
}

export function tokenizar(texto) {
  return normalizarTexto(texto)
    .split(' ')
    .filter((t) => t.length > 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
    .map(raiz);
}

/** Texto representativo de una votación histórica (cv_votaciones + cv_leyes). */
export function textoDeVotacion(v, ley) {
  return [
    v.nombre_ley,
    v.titulo,
    ley?.nombre,
    ley?.nombre_comun,
    (v.keywords ?? []).join(' '),
    (ley?.keywords ?? []).join(' '),
  ]
    .filter(Boolean)
    .join(' . ');
}

/** Texto de un proyecto nuevo: título pesa doble; del cuerpo se toman los primeros caracteres. */
export function textoDeProyecto({ titulo, resumen, texto }) {
  return [titulo, titulo, resumen, String(texto ?? '').slice(0, 4000)].filter(Boolean).join(' . ');
}

/** Bolsa de términos → vector TF-IDF disperso (Map índice → peso), normalizado L2. */
export function tfidf(texto, vocab, idf) {
  const cuentas = new Map();
  for (const t of tokenizar(texto)) {
    const i = vocab[t];
    if (i !== undefined) cuentas.set(i, (cuentas.get(i) ?? 0) + 1);
  }
  let norma = 0;
  for (const [i, c] of cuentas) {
    const w = (1 + Math.log(c)) * idf[i];
    cuentas.set(i, w);
    norma += w * w;
  }
  norma = Math.sqrt(norma) || 1;
  for (const [i, w] of cuentas) cuentas.set(i, w / norma);
  return cuentas;
}

/**
 * Proyección LSA ("fold-in"): e = x · V_k · Σ_k⁻¹, normalizado.
 * `lsa` = { vocab: {termino: i}, idf: number[], dims, proyeccion: Float32Array(V × dims) }
 */
export function embeber(texto, lsa) {
  const x = tfidf(texto, lsa.vocab, lsa.idf);
  const e = new Float64Array(lsa.dims);
  for (const [i, w] of x) {
    const base = i * lsa.dims;
    for (let k = 0; k < lsa.dims; k++) e[k] += w * lsa.proyeccion[base + k];
  }
  let norma = 0;
  for (let k = 0; k < lsa.dims; k++) norma += e[k] * e[k];
  norma = Math.sqrt(norma);
  // captura ∈ [0,1]: qué parte del vector TF-IDF (norma 1) sobrevive a la proyección.
  return {
    vector: norma ? Array.from(e, (v) => v / norma) : Array.from(e),
    terminos: x.size,
    captura: norma,
  };
}

export function coseno(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Coseno entre dos vectores TF-IDF dispersos (Map o array de [índice, peso]). */
export function cosenoDisperso(a, b) {
  const mapa = a instanceof Map ? a : new Map(a);
  let s = 0;
  for (const [i, w] of b instanceof Map ? b : b) s += (mapa.get(i) ?? 0) * w;
  return s;
}

export const PESO_LSA = 0.5;

/**
 * Similitud híbrida: LSA capta temas y sinónimos; TF-IDF exacto rescata términos raros
 * (p. ej. "interrupción voluntaria del embarazo") que la SVD de pocas dimensiones pierde.
 * El peso de LSA baja cuando la proyección representa mal alguno de los dos textos.
 */
export function similitud(consulta, doc) {
  const alfa = PESO_LSA * Math.sqrt((consulta.captura ?? 1) * (doc.captura ?? 1));
  return (
    alfa * coseno(consulta.vector, doc.vector) +
    (1 - alfa) * cosenoDisperso(consulta.disperso, doc.disperso)
  );
}

/** Representación completa (densa + dispersa) de un texto. */
export function representar(texto, lsa) {
  const { vector, terminos, captura } = embeber(texto, lsa);
  return { vector, disperso: tfidf(texto, lsa.vocab, lsa.idf), terminos, captura };
}
