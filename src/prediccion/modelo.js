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

/**
 * Proyecto sin antecedentes: mezcla la salida del modelo con cómo votó el diputado en las
 * votaciones divididas del mismo tema ([A, N] de esas votaciones), en proporción
 * `lambda × faltaPrecedente`. La ausencia no se toca (el tema no la informa).
 */
export function mezclarAntecedentesTema(p, [temaA, temaN], faltaPrecedente, lambda) {
  const w = Math.min(1, Math.max(0, lambda * faltaPrecedente));
  const totalTema = temaA + temaN;
  if (!w || totalTema <= 0) return p;
  const presente = p[0] + p[1] + p[2];
  const a = (1 - w) * p[0] + w * presente * (temaA / totalTema);
  const n = (1 - w) * p[1] + w * presente * (temaN / totalTema);
  const b = (1 - w) * p[2];
  const s = a + n + b;
  return [(a / s) * presente, (n / s) * presente, (b / s) * presente, p[3]];
}

/** Afila probabilidades: q_c^γ normalizado (γ = 1 no cambia nada). */
export function afilar(q, gamma) {
  if (!q) return q;
  const w = q.map((x) => Math.max(x, 0) ** gamma);
  const t = w[0] + w[1] + w[2] || 1;
  return w.map((x) => x / t);
}

/**
 * Postura del bloque INCIERTA (p. ej. estimada por el analista de IA): q = [qA, qN, qAbst].
 * Es la mezcla de las actualizaciones "duras": L(v) = Σ_c q_c · L_c(v), con
 * L_c(v) = disciplina si v = c y (1 − disciplina) / 2 si no. Con q de certeza = aplicarPosturaDeclarada.
 */
export function aplicarPosturaBlanda(p, q, disciplina) {
  if (!q) return p;
  const d = Math.min(Math.max(disciplina, 0.34), 0.995);
  const presente = p[0] + p[1] + p[2];
  const sq = q[0] + q[1] + q[2];
  if (presente <= 0 || sq <= 0) return p;
  const post = [0, 1, 2].map((v) => {
    let l = 0;
    for (let c = 0; c < 3; c++) l += (q[c] / sq) * (v === c ? d : (1 - d) / 2);
    return p[v] * l;
  });
  const suma = post[0] + post[1] + post[2];
  return [...post.map((x) => (x / suma) * presente), p[3]];
}

/**
 * Con supuestos declarados, la probabilidad de ausencia se toma de la predicción SIN supuestos:
 * declarar la postura de un bloque informa cómo vota, no si va a estar presente.
 */
export function conAusenciaSinSupuestos(pConSupuestos, pSinSupuestos) {
  const aus = pSinSupuestos[3];
  const presente = pConSupuestos[0] + pConSupuestos[1] + pConSupuestos[2] || 1;
  return [...[0, 1, 2].map((c) => (pConSupuestos[c] / presente) * (1 - aus)), aus];
}

/** Probabilidades calibradas [A, N, Abst, Aus] para un vector de features. */
export function predecirProbabilidades(modelo, x) {
  const z = modelo.tipo === 'gbdt' ? logitsGbdt(modelo, x) : logitsLogistica(modelo, x);
  return softmax(z, modelo.temperatura ?? 1);
}
