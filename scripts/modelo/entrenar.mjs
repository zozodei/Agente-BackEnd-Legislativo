// Entrena el modelo de producción y lo guarda en data/modelo/modelo.json.gz.
//   node scripts/modelo/entrenar.mjs [tipo=logistica|gbdt]
// Entrena con 2008 → (fin − 6 meses) con supuestos al azar (dropout) y calibra la temperatura
// con los últimos 6 meses, que el modelo no vio.
import { join } from 'node:path';
import { DIR_MODELO, leerJsonGz, escribirJsonGz } from '../dataset/comun.mjs';
import { Historia, diaDe } from '../../src/prediccion/historia.js';
import { N_FEATURES, NOMBRES_FEATURES } from '../../src/prediccion/features.js';
import { softmax } from '../../src/prediccion/modelo.js';
import { construirFilas } from './filas.mjs';
import {
  entrenarLogistica,
  entrenarGbdt,
  calibrarTemperatura,
  logits,
  metricas,
} from './aprendizaje.mjs';
import { CLASES } from '../../src/prediccion/historia.js';

export const HIPERPARAMETROS = {
  logistica: { lambda: 1e-4, epocas: 20 },
  gbdt: { rondas: 120, tasa: 0.12, profundidad: 5, minHoja: 100, submuestra: 0.35, columnas: 0.7 },
};

const tipo = process.argv[2] ?? 'logistica';
const historia = new Historia(leerJsonGz(join(DIR_MODELO, 'historia.json.gz')));
const ultimoDia = historia.votaciones.at(-1).dia;
const corte = ultimoDia - 183;
const D = N_FEATURES;

const t0 = Date.now();
const ent = construirFilas(historia, {
  desdeDia: diaDe('2008-01-01'),
  hastaDia: corte,
  supuestos: 'dropout',
});
const cal = construirFilas(historia, {
  desdeDia: corte,
  hastaDia: ultimoDia + 1,
  supuestos: 'ninguno',
});
console.log(`filas: entrenamiento ${ent.y.length}, calibración ${cal.y.length}`);

const modelo =
  tipo === 'gbdt'
    ? entrenarGbdt(ent.X, ent.y, D, { ...HIPERPARAMETROS.gbdt, log: true })
    : entrenarLogistica(ent.X, ent.y, D, HIPERPARAMETROS.logistica);
const Z = logits(modelo, cal.X, D);
modelo.temperatura = calibrarTemperatura(Z, cal.y);
const m = metricas(
  Z.map((z) => softmax(z, modelo.temperatura)),
  cal.y,
  CLASES,
);

const fechaDatos = historia.votaciones.at(-1).fecha;
modelo.version = `${tipo}-${fechaDatos}-${new Date().toISOString().slice(0, 10)}`;
modelo.features = NOMBRES_FEATURES;
modelo.entrenamiento = {
  filas: ent.y.length,
  desde: '2008-01-01',
  hasta: new Date(corte * 86_400_000).toISOString().slice(0, 10),
  calibracion: {
    filas: cal.y.length,
    temperatura: modelo.temperatura,
    accuracy: m.accuracy,
    f1Macro: m.f1Macro,
    logloss: m.logloss,
    ece: m.ece,
  },
  hiperparametros: HIPERPARAMETROS[tipo],
  datosAl: fechaDatos,
  segundos: Math.round((Date.now() - t0) / 1000),
};
escribirJsonGz(join(DIR_MODELO, 'modelo.json.gz'), modelo);
console.log(
  `modelo ${modelo.version}: T=${modelo.temperatura.toFixed(2)} acc=${(m.accuracy * 100).toFixed(1)}% F1m=${m.f1Macro.toFixed(3)} ECE=${m.ece.toFixed(3)}`,
);
