// Entrena la representación LSA (TF-IDF + SVD truncada aleatorizada) sobre los textos de las
// votaciones y guarda data/modelo/lsa.json.gz + los embeddings de cada votación.
//   node scripts/modelo/lsa.mjs [dims=96]
import { join } from 'node:path';
import { leerRaw, escribirJsonGz, DIR_MODELO } from '../dataset/comun.mjs';
import { tokenizar, textoDeVotacion, embeber, tfidf } from '../../src/prediccion/similitud.js';

const DIMS = Number(process.argv[2] ?? 96);
const SOBREMUESTREO = 16;
const ITER_POTENCIA = 3;

// Generador pseudoaleatorio determinista (mulberry32) para que el entrenamiento sea reproducible.
function rng(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const azar = rng(42);
const gauss = () => Math.sqrt(-2 * Math.log(azar() + 1e-12)) * Math.cos(2 * Math.PI * azar());

const votaciones = leerRaw('cv_votaciones');
const leyes = new Map(leerRaw('cv_leyes').map((l) => [l.id, l]));
const textos = votaciones.map((v) => textoDeVotacion(v, leyes.get(v.ley_id)));

// Vocabulario: términos en ≥ 2 votaciones y < 40 % de ellas.
const df = new Map();
const tokensDoc = textos.map((t) => {
  const tk = tokenizar(t);
  for (const x of new Set(tk)) df.set(x, (df.get(x) ?? 0) + 1);
  return tk;
});
const n = textos.length;
const terminos = [...df]
  .filter(([, c]) => c >= 2 && c < 0.4 * n)
  .map(([t]) => t)
  .sort();
const vocab = Object.fromEntries(terminos.map((t, i) => [t, i]));
const V = terminos.length;
const idf = terminos.map((t) => Math.log((1 + n) / (1 + df.get(t))) + 1);

// Matriz dispersa A (n × V), filas TF-IDF normalizadas.
const filas = tokensDoc.map((tk) => {
  const c = new Map();
  for (const t of tk) if (vocab[t] !== undefined) c.set(vocab[t], (c.get(vocab[t]) ?? 0) + 1);
  let norma = 0;
  const f = [];
  for (const [i, k] of c) {
    const w = (1 + Math.log(k)) * idf[i];
    f.push([i, w]);
    norma += w * w;
  }
  norma = Math.sqrt(norma) || 1;
  return f.map(([i, w]) => [i, w / norma]);
});

const L = DIMS + SOBREMUESTREO;
// A · M  (M: V × L denso, por columnas en Float64Array de V*L, índice [i*L + j])
function multA(M) {
  const R = new Float64Array(n * L);
  filas.forEach((f, r) => {
    for (const [i, w] of f) for (let j = 0; j < L; j++) R[r * L + j] += w * M[i * L + j];
  });
  return R;
}
// Aᵀ · Y  (Y: n × L)
function multAt(Y) {
  const R = new Float64Array(V * L);
  filas.forEach((f, r) => {
    for (const [i, w] of f) for (let j = 0; j < L; j++) R[i * L + j] += w * Y[r * L + j];
  });
  return R;
}
// Ortonormaliza columnas (Gram-Schmidt modificado), filas = m.
function ortonormalizar(M, m) {
  for (let j = 0; j < L; j++) {
    for (let k = 0; k < j; k++) {
      let d = 0;
      for (let r = 0; r < m; r++) d += M[r * L + j] * M[r * L + k];
      for (let r = 0; r < m; r++) M[r * L + j] -= d * M[r * L + k];
    }
    let s = 0;
    for (let r = 0; r < m; r++) s += M[r * L + j] ** 2;
    s = Math.sqrt(s) || 1;
    for (let r = 0; r < m; r++) M[r * L + j] /= s;
  }
  return M;
}
// Autovalores/vectores de una simétrica L×L (Jacobi cíclico).
function jacobi(S) {
  const A = S.map((f) => f.slice());
  const Vv = A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0)));
  for (let barrido = 0; barrido < 100; barrido++) {
    let off = 0;
    for (let p = 0; p < L; p++) for (let q = p + 1; q < L; q++) off += A[p][q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < L; p++)
      for (let q = p + 1; q < L; q++) {
        if (Math.abs(A[p][q]) < 1e-15) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < L; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < L; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < L; k++) {
          const vkp = Vv[k][p];
          const vkq = Vv[k][q];
          Vv[k][p] = c * vkp - s * vkq;
          Vv[k][q] = s * vkp + c * vkq;
        }
      }
  }
  return { valores: A.map((f, i) => f[i]), vectores: Vv };
}

const t0 = Date.now();
const Om = new Float64Array(V * L).map(() => gauss());
let Y = ortonormalizar(multA(Om), n);
for (let it = 0; it < ITER_POTENCIA; it++) {
  const Z = ortonormalizar(multAt(Y), V);
  Y = ortonormalizar(multA(Z), n);
}
// B = Qᵀ A  → Bᵀ = Aᵀ Q  (V × L)
const Bt = multAt(Y);
// B Bᵀ = (Bt)ᵀ Bt  (L × L)
const BBt = Array.from({ length: L }, () => new Array(L).fill(0));
for (let i = 0; i < V; i++)
  for (let a = 0; a < L; a++) {
    const x = Bt[i * L + a];
    if (!x) continue;
    for (let b = a; b < L; b++) BBt[a][b] += x * Bt[i * L + b];
  }
for (let a = 0; a < L; a++) for (let b = 0; b < a; b++) BBt[a][b] = BBt[b][a];
const { valores, vectores } = jacobi(BBt);
const orden = valores
  .map((v, i) => [v, i])
  .sort((a, b) => b[0] - a[0])
  .slice(0, DIMS);
const sigma = orden.map(([v]) => Math.sqrt(Math.max(v, 0)));
// V_k = Bᵀ U_b Σ⁻¹  (V × DIMS)
const proyeccion = new Float32Array(V * DIMS);
for (let i = 0; i < V; i++)
  orden.forEach(([, col], k) => {
    let s = 0;
    for (let a = 0; a < L; a++) s += Bt[i * L + a] * vectores[a][col];
    proyeccion[i * DIMS + k] = sigma[k] ? s / sigma[k] : 0;
  });

const lsa = { dims: DIMS, vocab, idf, proyeccion };
const embeddings = {};
votaciones.forEach((v, i) => {
  const e = embeber(textos[i], lsa);
  embeddings[v.id] = {
    vector: e.vector.map((x) => Math.round(x * 1e5) / 1e5),
    captura: Math.round(e.captura * 1e4) / 1e4,
    disperso: [...tfidf(textos[i], vocab, idf)].map(([k, w]) => [k, Math.round(w * 1e4) / 1e4]),
  };
});
const varianza = sigma.reduce((s, x) => s + x * x, 0);
escribirJsonGz(join(DIR_MODELO, 'lsa.json.gz'), {
  dims: DIMS,
  vocab,
  idf: idf.map((x) => Math.round(x * 1e4) / 1e4),
  proyeccion: Array.from(proyeccion, (x) => Math.round(x * 1e5) / 1e5),
});
escribirJsonGz(join(DIR_MODELO, 'embeddings_lsa.json.gz'), embeddings);
console.log(
  `LSA: ${V} términos, ${DIMS} dimensiones, varianza capturada ${(varianza / n).toFixed(3)}, ${((Date.now() - t0) / 1000).toFixed(1)} s`,
);
