// Inferencia de los modelos entrenados (JS puro, sin dependencias).
// Formatos (data/modelo/modelo.json):
//   { tipo: 'logistica', media, desv, W: [K][D+1], temperatura }
//   { tipo: 'gbdt', base: [K], tasa, arboles: [[nodos de la clase k] por ronda], temperatura }
//     nodo hoja: { v }  nodo interno: { f, u, i, d } (feature, umbral, izq si x <= u, der)

export function softmax(z, temperatura = 1) {
  const m = Math.max(...z);
  const e = z.map((x) => Math.exp((x - m) / temperatura));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

export function logitsLogistica(modelo, x) {
  const { W, media, desv } = modelo;
  return W.map((w) => {
    let z = w[w.length - 1];
    for (let j = 0; j < x.length; j++) z += w[j] * ((x[j] - media[j]) / desv[j]);
    return z;
  });
}

function evaluarArbol(nodos, x) {
  let n = 0;
  for (;;) {
    const nodo = nodos[n];
    if (nodo.v !== undefined) return nodo.v;
    n = x[nodo.f] <= nodo.u ? nodo.i : nodo.d;
  }
}

export function logitsGbdt(modelo, x) {
  const z = modelo.base.slice();
  for (const ronda of modelo.arboles) {
    for (let k = 0; k < z.length; k++) z[k] += modelo.tasa * evaluarArbol(ronda[k], x);
  }
  return z;
}

/**
 * Supuesto del escenario "su bloque vota `declarado`" (0 A, 1 N, 2 Abst) como actualización
 * bayesiana con la disciplina del diputado: P(v) ∝ P(v) · L(v), con L = disciplina si v coincide
 * y (1 − disciplina) / 2 si no. La probabilidad de ausencia no cambia (el supuesto no la informa).
 */
export function aplicarPosturaDeclarada(p, declarado, disciplina) {
  if ((declarado ?? null) === null || declarado < 0 || declarado > 2) return p;
  const d = Math.min(Math.max(disciplina, 0.34), 0.995);
  const presente = p[0] + p[1] + p[2];
  if (presente <= 0) return p;
  const post = [0, 1, 2].map((c) => p[c] * (c === declarado ? d : (1 - d) / 2));
  const suma = post[0] + post[1] + post[2];
  return [...post.map((x) => (x / suma) * presente), p[3]];
}

/** Probabilidades calibradas [A, N, Abst, Aus] para un vector de features. */
export function predecirProbabilidades(modelo, x) {
  const z = modelo.tipo === 'gbdt' ? logitsGbdt(modelo, x) : logitsLogistica(modelo, x);
  return softmax(z, modelo.temperatura ?? 1);
}
