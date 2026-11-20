// Gradient boosting multiclase (softmax) con histogramas: un árbol por clase y ronda.
// Bins por columna (acceso secuencial) y resta de histogramas (hijo grande = padre − chico).
// La inferencia está en src/prediccion/modelo.js (logitsGbdt).
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

export function entrenarGbdt(
  X,
  y,
  D,
  {
    rondas = 150,
    tasa = 0.1,
    profundidad = 5,
    minHoja = 80,
    lambda = 1,
    bins = 32,
    submuestra = 0.5,
    columnas = 0.7,
    semilla = 7,
    log = false,
  } = {},
) {
  const n = y.length;
  const azar = rng(semilla);
  const umbrales = [];
  const Xb = new Uint8Array(n * D); // por columna: Xb[f * n + i]
  for (let j = 0; j < D; j++) {
    const muestra = [];
    const paso = Math.max(1, Math.floor(n / 20000));
    for (let i = 0; i < n; i += paso) muestra.push(X[i * D + j]);
    muestra.sort((a, b) => a - b);
    const u = [];
    for (let b = 1; b < bins; b++) {
      const val = muestra[Math.floor((b / bins) * (muestra.length - 1))];
      if (!u.length || val > u[u.length - 1]) u.push(val);
    }
    umbrales.push(u);
    const off = j * n;
    for (let i = 0; i < n; i++) {
      const x = X[i * D + j];
      let lo = 0;
      let hi = u.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (x <= u[mid]) hi = mid;
        else lo = mid + 1;
      }
      Xb[off + i] = lo; // bin = cantidad de umbrales < x  ⇒  bin <= b  ⇔  x <= u[b]
    }
  }
  const frec = new Array(K).fill(0);
  for (let i = 0; i < n; i++) frec[y[i]]++;
  const base = frec.map((f) => Math.log((f + 1) / (n + K)));
  const F = new Float64Array(n * K);
  for (let i = 0; i < n; i++) for (let k = 0; k < K; k++) F[i * K + k] = base[k];
  const arboles = [];
  const G = new Float64Array(n);
  const H = new Float64Array(n);
  const probs = new Float64Array(n * K);
  const ctx = { Xb, n, umbrales, G, H, profundidad, minHoja, lambda, bins };

  for (let r = 0; r < rondas; r++) {
    let m = 0;
    const tmp = new Uint32Array(n);
    for (let i = 0; i < n; i++) if (azar() < submuestra) tmp[m++] = i;
    const filas = tmp.slice(0, m);
    const cols = [];
    for (let j = 0; j < D; j++) if (azar() < columnas) cols.push(j);
    for (let t = 0; t < m; t++) {
      const i = filas[t];
      let max = -Infinity;
      for (let k = 0; k < K; k++) if (F[i * K + k] > max) max = F[i * K + k];
      let suma = 0;
      for (let k = 0; k < K; k++) {
        probs[i * K + k] = Math.exp(F[i * K + k] - max);
        suma += probs[i * K + k];
      }
      for (let k = 0; k < K; k++) probs[i * K + k] /= suma;
    }
    const ronda = [];
    for (let k = 0; k < K; k++) {
      for (let t = 0; t < m; t++) {
        const i = filas[t];
        const p = probs[i * K + k];
        G[i] = p - (y[i] === k ? 1 : 0);
        H[i] = Math.max(p * (1 - p), 1e-6);
      }
      ronda.push(construirArbol(filas, cols, ctx));
    }
    for (let k = 0; k < K; k++) {
      const nodos = ronda[k];
      for (let i = 0; i < n; i++) {
        let nd = 0;
        while (nodos[nd].v === undefined) {
          nd = Xb[nodos[nd].f * n + i] <= nodos[nd].b ? nodos[nd].i : nodos[nd].d;
        }
        F[i * K + k] += tasa * nodos[nd].v;
      }
    }
    arboles.push(ronda.map((nodos) => nodos.map(({ b: _b, ...resto }) => resto)));
    if (log && r % 20 === 0) console.log(`  ronda ${r}/${rondas}`);
  }
  return { tipo: 'gbdt', base, tasa, arboles, temperatura: 1 };
}

function histogramas(idx, cols, { Xb, n, G, H, bins }) {
  const nc = cols.length;
  const hg = new Float64Array(nc * bins);
  const hh = new Float64Array(nc * bins);
  const hc = new Uint32Array(nc * bins);
  for (let c = 0; c < nc; c++) {
    const off = cols[c] * n;
    const base = c * bins;
    for (let t = 0; t < idx.length; t++) {
      const i = idx[t];
      const b = base + Xb[off + i];
      hg[b] += G[i];
      hh[b] += H[i];
      hc[b]++;
    }
  }
  return { hg, hh, hc };
}

function restar(padre, chico) {
  const hg = new Float64Array(padre.hg.length);
  const hh = new Float64Array(padre.hh.length);
  const hc = new Uint32Array(padre.hc.length);
  for (let q = 0; q < hg.length; q++) {
    hg[q] = padre.hg[q] - chico.hg[q];
    hh[q] = padre.hh[q] - chico.hh[q];
    hc[q] = padre.hc[q] - chico.hc[q];
  }
  return { hg, hh, hc };
}

function construirArbol(filas, cols, ctx) {
  const { Xb, n, umbrales, G, H, profundidad, minHoja, lambda, bins } = ctx;
  const nodos = [null];
  // paso de Newton con el factor (K-1)/K del softmax multiclase
  const hoja = (gT, hT) => ({ v: (-gT / (hT + lambda)) * ((K - 1) / K) });
  let g0 = 0;
  let h0 = 0;
  for (let t = 0; t < filas.length; t++) {
    g0 += G[filas[t]];
    h0 += H[filas[t]];
  }
  const cola = [{ idx: filas, nivel: 0, pos: 0, hist: null, gT: g0, hT: h0 }];
  while (cola.length) {
    const nodo = cola.shift();
    const { idx, nivel, pos, gT, hT } = nodo;
    if (nivel >= profundidad || idx.length < 2 * minHoja) {
      nodos[pos] = hoja(gT, hT);
      continue;
    }
    const hist = nodo.hist ?? histogramas(idx, cols, ctx);
    const puntajeBase = (gT * gT) / (hT + lambda);
    let mejor = { ganancia: 1e-6, c: -1, b: -1, gl: 0, hl: 0 };
    for (let c = 0; c < cols.length; c++) {
      const nb = umbrales[cols[c]].length;
      const base = c * bins;
      let gl = 0;
      let hl = 0;
      let cl = 0;
      for (let b = 0; b < nb; b++) {
        gl += hist.hg[base + b];
        hl += hist.hh[base + b];
        cl += hist.hc[base + b];
        if (cl < minHoja) continue;
        if (idx.length - cl < minHoja) break;
        const gr = gT - gl;
        const hr = hT - hl;
        const ganancia = (gl * gl) / (hl + lambda) + (gr * gr) / (hr + lambda) - puntajeBase;
        if (ganancia > mejor.ganancia) mejor = { ganancia, c, b, gl, hl };
      }
    }
    if (mejor.c < 0) {
      nodos[pos] = hoja(gT, hT);
      continue;
    }
    const f = cols[mejor.c];
    const off = f * n;
    let ni = 0;
    for (let t = 0; t < idx.length; t++) if (Xb[off + idx[t]] <= mejor.b) ni++;
    const izq = new Uint32Array(ni);
    const der = new Uint32Array(idx.length - ni);
    let a = 0;
    let z = 0;
    for (let t = 0; t < idx.length; t++) {
      const i = idx[t];
      if (Xb[off + i] <= mejor.b) izq[a++] = i;
      else der[z++] = i;
    }
    const pi = nodos.length;
    nodos.push(null);
    const pd = nodos.length;
    nodos.push(null);
    nodos[pos] = { f, u: umbrales[f][mejor.b], b: mejor.b, i: pi, d: pd };
    let histIzq = null;
    let histDer = null;
    if (nivel + 1 < profundidad) {
      const izqChico = izq.length <= der.length;
      const hChico = histogramas(izqChico ? izq : der, cols, ctx);
      const hGrande = restar(hist, hChico);
      [histIzq, histDer] = izqChico ? [hChico, hGrande] : [hGrande, hChico];
    }
    cola.push(
      { idx: izq, nivel: nivel + 1, pos: pi, hist: histIzq, gT: mejor.gl, hT: mejor.hl },
      { idx: der, nivel: nivel + 1, pos: pd, hist: histDer, gT: gT - mejor.gl, hT: hT - mejor.hl },
    );
  }
  return nodos;
}
