// ¿Conviene mezclar la salida del modelo con los votos en votaciones divididas del mismo tema
// cuando el proyecto no tiene antecedentes? Mide sobre las votaciones de prueba sin precedente.
//   node scripts/modelo/evaluar-sin-antecedentes.mjs
import { join } from 'node:path';
import { DIR_MODELO, leerJsonGz } from '../dataset/comun.mjs';
import { Historia, CLASES, diaDe } from '../../src/prediccion/historia.js';
import { NOMBRES_FEATURES, N_FEATURES } from '../../src/prediccion/features.js';
import { softmax, mezclarAntecedentesTema } from '../../src/prediccion/modelo.js';
import { construirFilas } from './filas.mjs';
import { entrenarLogistica, calibrarTemperatura, logits, metricas } from './aprendizaje.mjs';
const CORTES = {
  entrenamientoDesde: '2008-01-01',
  validacionDesde: '2023-01-01',
  pruebaDesde: '2024-07-01',
  pruebaHasta: '2026-12-31',
};

const h = new Historia(leerJsonGz(join(DIR_MODELO, 'historia.json.gz')));
const D = N_FEATURES;
const col = (n) => NOMBRES_FEATURES.indexOf(n);
const ent = construirFilas(h, {
  desdeDia: diaDe(CORTES.entrenamientoDesde),
  hastaDia: diaDe(CORTES.validacionDesde),
  supuestos: 'dropout',
});
const val = construirFilas(h, {
  desdeDia: diaDe(CORTES.validacionDesde),
  hastaDia: diaDe(CORTES.pruebaDesde),
});
// Todo lo posterior al entrenamiento (2023–2026) para tener suficientes votaciones sin antecedente.
const pru = construirFilas(h, {
  desdeDia: diaDe(CORTES.validacionDesde),
  hastaDia: diaDe(CORTES.pruebaHasta),
});
const modelo = entrenarLogistica(ent.X, ent.y, D, { lambda: 1e-4, epocas: 20 });
modelo.temperatura = calibrarTemperatura(logits(modelo, val.X, D), val.y);
const P = logits(modelo, pru.X, D).map((z) => softmax(z, modelo.temperatura));

const [cF, cTA, cTN, cN] = ['falta_precedente', 'tema_dep_A', 'tema_dep_N', 'n_tema_div'].map(col);
const idx = [];
for (let i = 0; i < pru.y.length; i++) {
  const x = pru.X.subarray(i * D, (i + 1) * D);
  if (x[cF] >= 0.3 && x[cN] > 0) idx.push(i);
}
const votaciones = new Set(idx.map((i) => pru.filas[i].iv));
console.log(
  `filas sin antecedente con divididas del tema: ${idx.length} (${votaciones.size} votaciones)`,
);
const y = Uint8Array.from(idx, (i) => pru.y[i]);
for (const lambda of [0, 0.3, 0.5, 0.7, 0.9]) {
  const Pm = idx.map((i) => {
    const x = pru.X.subarray(i * D, (i + 1) * D);
    return mezclarAntecedentesTema(P[i], [x[cTA], x[cTN]], x[cF], lambda);
  });
  const m = metricas(Pm, y, CLASES);
  console.log(
    `λ=${lambda}: acc ${(m.accuracy * 100).toFixed(1)}%  F1m ${m.f1Macro.toFixed(3)}  logloss ${m.logloss.toFixed(3)}  ECE ${m.ece.toFixed(3)}  F1 neg ${m.porClase[1].f1.toFixed(3)}`,
  );
}
