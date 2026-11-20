// Entrenamiento y métricas: regresión logística multinomial, gradient boosting y calibración.
// Datos: X = Float32Array (n × D, por filas), y = Uint8Array (n) con clases 0..K-1.
import { softmax, logitsLogistica, logitsGbdt } from '../../src/prediccion/modelo.js';
export { entrenarGbdt } from './gbdt.mjs';

export const K = 4;

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

// ------------------------------------------------------------------ logística
export function entrenarLogistica(
  X,
  y,
  D,
  { lambda = 1e-4, epocas = 25, lote = 512, tasa = 0.01, semilla = 1 } = {},
) {
  const n = y.length;
  const media = new Array(D).fill(0);
  const desv = new Array(D).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < D; j++) media[j] += X[i * D + j] / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < D; j++) desv[j] += (X[i * D + j] - media[j]) ** 2 / n;
  for (let j = 0; j < D; j++) desv[j] = Math.sqrt(desv[j]) || 1;
  const Z = new Float32Array(n * D);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < D; j++) Z[i * D + j] = (X[i * D + j] - media[j]) / desv[j];

  const P = D + 1;
  const W = new Float64Array(K * P);
  const m = new Float64Array(K * P);
  const v = new Float64Array(K * P);
  const b1 = 0.9;
  const b2 = 0.999;
  let paso = 0;
  const azar = rng(semilla);
  const orden = Uint32Array.from({ length: n }, (_, i) => i);
  const grad = new Float64Array(K * P);
  const z = new Float64Array(K);
  for (let ep = 0; ep < epocas; ep++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(azar() * (i + 1));
      [orden[i], orden[j]] = [orden[j], orden[i]];
    }
    const tasaEp = tasa * (ep < epocas * 0.6 ? 1 : ep < epocas * 0.85 ? 0.3 : 0.1);
    for (let ini = 0; ini < n; ini += lote) {
      const fin = Math.min(n, ini + lote);
      grad.fill(0);
      for (let t = ini; t < fin; t++) {
        const i = orden[t];
        let max = -Infinity;
        for (let k = 0; k < K; k++) {
          let s = W[k * P + D];
          for (let j = 0; j < D; j++) s += W[k * P + j] * Z[i * D + j];
          z[k] = s;
          if (s > max) max = s;
        }
        let suma = 0;
        for (let k = 0; k < K; k++) suma += z[k] = Math.exp(z[k] - max);
        for (let k = 0; k < K; k++) {
          const g = z[k] / suma - (y[i] === k ? 1 : 0);
          for (let j = 0; j < D; j++) grad[k * P + j] += g * Z[i * D + j];
          grad[k * P + D] += g;
        }
      }
      const bs = fin - ini;
      paso++;
      for (let q = 0; q < K * P; q++) {
        const g = grad[q] / bs + (q % P === D ? 0 : lambda * W[q]);
        m[q] = b1 * m[q] + (1 - b1) * g;
        v[q] = b2 * v[q] + (1 - b2) * g * g;
        const mh = m[q] / (1 - b1 ** paso);
        const vh = v[q] / (1 - b2 ** paso);
        W[q] -= (tasaEp * mh) / (Math.sqrt(vh) + 1e-8);
      }
    }
  }
  const Wm = Array.from({ length: K }, (_, k) => Array.from(W.subarray(k * P, (k + 1) * P)));
  return { tipo: 'logistica', media, desv, W: Wm, temperatura: 1 };
}

// ------------------------------------------------------------------ calibración
export function logits(modelo, X, D) {
  const n = X.length / D;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = X.subarray(i * D, (i + 1) * D);
    out[i] = modelo.tipo === 'gbdt' ? logitsGbdt(modelo, x) : logitsLogistica(modelo, x);
  }
  return out;
}

export function nll(Z, y, T) {
  let s = 0;
  for (let i = 0; i < y.length; i++) s -= Math.log(Math.max(softmax(Z[i], T)[y[i]], 1e-12));
  return s / y.length;
}

/** Temperatura que minimiza la log-loss en validación (búsqueda dorada en [0.3, 5]). */
export function calibrarTemperatura(Z, y) {
  let a = 0.3;
  let b = 5;
  const phi = (Math.sqrt(5) - 1) / 2;
  for (let it = 0; it < 40; it++) {
    const c = b - phi * (b - a);
    const d = a + phi * (b - a);
    if (nll(Z, y, c) < nll(Z, y, d)) b = d;
    else a = c;
  }
  return (a + b) / 2;
}

// ------------------------------------------------------------------ métricas
export function metricas(P, y, nombres) {
  const n = y.length;
  const conf = Array.from({ length: K }, () => new Array(K).fill(0));
  let acierto = 0;
  let logloss = 0;
  let brier = 0;
  const binsEce = Array.from({ length: 10 }, () => ({ n: 0, conf: 0, acc: 0 }));
  for (let i = 0; i < n; i++) {
    const p = P[i];
    let pred = 0;
    for (let k = 1; k < K; k++) if (p[k] > p[pred]) pred = k;
    conf[y[i]][pred]++;
    if (pred === y[i]) acierto++;
    logloss -= Math.log(Math.max(p[y[i]], 1e-12));
    for (let k = 0; k < K; k++) brier += (p[k] - (y[i] === k ? 1 : 0)) ** 2;
    const b = Math.min(9, Math.floor(p[pred] * 10));
    binsEce[b].n++;
    binsEce[b].conf += p[pred];
    binsEce[b].acc += pred === y[i] ? 1 : 0;
  }
  const porClase = nombres.map((nombre, k) => {
    const tp = conf[k][k];
    const fp = conf.reduce((s, f, r) => s + (r === k ? 0 : f[k]), 0);
    const fn = conf[k].reduce((s, x, c) => s + (c === k ? 0 : x), 0);
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { clase: nombre, soporte: tp + fn, precision, recall, f1 };
  });
  const ece = binsEce.reduce(
    (s, b) => s + (b.n ? (b.n / n) * Math.abs(b.acc / b.n - b.conf / b.n) : 0),
    0,
  );
  return {
    n,
    accuracy: acierto / n,
    f1Macro: porClase.reduce((s, c) => s + c.f1, 0) / K,
    porClase,
    logloss: logloss / n,
    brier: brier / n,
    ece,
    confiabilidad: binsEce.map((b, i) => ({
      desde: i / 10,
      hasta: (i + 1) / 10,
      n: b.n,
      confianzaMedia: b.n ? b.conf / b.n : null,
      aciertoReal: b.n ? b.acc / b.n : null,
    })),
    matrizConfusion: conf,
  };
}
