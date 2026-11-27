// Imprime en Markdown las tablas de EVALUACION_MODELOS.md a partir de data/modelo/evaluacion/*.json
//   node scripts/modelo/reporte.mjs > /tmp/tablas.md
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIR_MODELO } from '../dataset/comun.mjs';

const leer = (v) => {
  const p = join(DIR_MODELO, 'evaluacion', `${v}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};
const pct = (x) => `${(x * 100).toFixed(1)} %`;
const n2 = (x) => x.toFixed(3);
const lsa = leer('lsa');

console.log(
  `Filas: entrenamiento ${lsa.filas.entrenamiento.toLocaleString('es-AR')}, validación ${lsa.filas.validacion.toLocaleString('es-AR')}, prueba ${lsa.filas.prueba.toLocaleString('es-AR')}.\n`,
);

const fila = (nombre, r) =>
  `| ${nombre} | ${pct(r.todas.accuracy)} | ${n2(r.todas.f1Macro)} | ${n2(r.todas.logloss)} | ${n2(r.todas.ece)} | ${pct(r.proyectosEnGeneral.accuracy)} | ${n2(r.proyectosEnGeneral.f1Macro)} | ${r.votaciones.maeConteo.AFIRMATIVO.toFixed(1)} / ${r.votaciones.maeConteo.NEGATIVO.toFixed(1)} / ${r.votaciones.maeConteo.AUSENTE.toFixed(1)} | ${r.votaciones.aciertoResultado}/${r.votaciones.n} |`;
console.log('### Prueba: predicción pura (sin supuestos)\n');
console.log(
  '| Modelo | Accuracy | F1 macro | Log-loss | ECE | Accuracy (proyectos en general) | F1 macro (proyectos) | Error medio por votación A / N / Aus | Resultado acertado |',
);
console.log('|---|---|---|---|---|---|---|---|---|');
const m = lsa.modelos;
console.log(fila('a0) Constante (frecuencias)', m.constante));
console.log(fila('a) Mayoría del bloque en votaciones parecidas', m.mayoriaBloque));
console.log(fila('b1) Regresión logística', m.logistica));
console.log(fila('b2) Gradient boosting', m.gbdt));
console.log(
  fila('a*) Techo: mayoría real del bloque en esa votación (no realizable)', m.oraculoBloque),
);

console.log('\n### Prueba: con supuestos del escenario declarados\n');
console.log(
  '| Modelo | Supuesto | Accuracy | F1 macro | Log-loss | ECE | Error medio N por votación | Error medio A por votación |',
);
console.log('|---|---|---|---|---|---|---|---|');
for (const [nombre, r] of [
  ['Logística', m.logistica],
  ['Boosting', m.gbdt],
]) {
  for (const [clave, etiqueta] of [
    ['conOficialismoDeclarado', 'Postura del oficialismo (aprendida)'],
    ['conOficialismoDeclaradoBayes', 'Postura del oficialismo + bayes'],
    ['conBloquesDeclarados', 'Postura de cada bloque (aprendida)'],
    ['conBloquesDeclaradosBayes', 'Postura de cada bloque + bayes'],
  ]) {
    const x = r[clave];
    if (!x) continue;
    console.log(
      `| ${nombre} | ${etiqueta} | ${pct(x.todas.accuracy)} | ${n2(x.todas.f1Macro)} | ${n2(x.todas.logloss)} | ${n2(x.todas.ece)} | ${x.votaciones.maeConteo.NEGATIVO.toFixed(1)} | ${x.votaciones.maeConteo.AFIRMATIVO.toFixed(1)} |`,
    );
  }
}

console.log('\n### F1 por clase (logística, prueba, sin supuestos)\n');
console.log('| Clase | Soporte | Precisión | Recall | F1 |');
console.log('|---|---|---|---|---|');
for (const c of m.logistica.todas.porClase)
  console.log(
    `| ${c.clase} | ${c.soporte.toLocaleString('es-AR')} | ${pct(c.precision)} | ${pct(c.recall)} | ${n2(c.f1)} |`,
  );
console.log('\n### F1 por clase (logística, prueba, con bloques declarados + bayes)\n');
console.log('| Clase | Soporte | Precisión | Recall | F1 |');
console.log('|---|---|---|---|---|');
for (const c of m.logistica.conBloquesDeclaradosBayes.todas.porClase)
  console.log(
    `| ${c.clase} | ${c.soporte.toLocaleString('es-AR')} | ${pct(c.precision)} | ${pct(c.recall)} | ${n2(c.f1)} |`,
  );

console.log('\n### Calibración (logística, prueba, sin supuestos)\n');
console.log('| Confianza predicha | Predicciones | Confianza media | Acierto real |');
console.log('|---|---|---|---|');
for (const b of m.logistica.todas.confiabilidad)
  if (b.n)
    console.log(
      `| ${pct(b.desde)}–${pct(b.hasta)} | ${b.n.toLocaleString('es-AR')} | ${pct(b.confianzaMedia)} | ${pct(b.aciertoReal)} |`,
    );

console.log('\n### Ablación de la búsqueda de proyectos parecidos (logística)\n');
console.log(
  '| Representación | Accuracy | F1 macro | Log-loss | Accuracy proyectos | Error N por votación | Con bloques declarados |',
);
console.log('|---|---|---|---|---|---|---|');
for (const [v, etiqueta] of [
  ['lsa', 'LSA 96 dim + TF-IDF (producción)'],
  ['minilm_hibrido', 'MiniLM multilingüe 384 dim + TF-IDF'],
  ['minilm', 'MiniLM multilingüe sola'],
  ['sin_similitud', 'Sin búsqueda de similares'],
]) {
  const r = leer(v)?.modelos.logistica;
  if (!r) continue;
  console.log(
    `| ${etiqueta} | ${pct(r.todas.accuracy)} | ${n2(r.todas.f1Macro)} | ${n2(r.todas.logloss)} | ${pct(r.proyectosEnGeneral.accuracy)} | ${r.votaciones.maeConteo.NEGATIVO.toFixed(1)} | ${pct(r.conBloquesDeclarados.todas.accuracy)} |`,
  );
}

console.log('\n### Importancia (logística: |peso estandarizado| máximo entre clases)\n');
console.log(
  lsa.importanciaLogistica
    .slice(0, 12)
    .map((x) => `\`${x.nombre}\` (${x.peso.toFixed(2)})`)
    .join(', '),
);
console.log('\n### Importancia (boosting: cantidad de cortes)\n');
console.log(
  lsa.importanciaGbdt
    .slice(0, 12)
    .map((x) => `\`${x.nombre}\` (${x.cortes})`)
    .join(', '),
);

// Votaciones de prueba más divididas: real vs esperado
console.log(
  '\n### Votaciones de prueba más divididas (logística sin supuestos y con bloques declarados + bayes)\n',
);
console.log(
  '| Fecha | Votación | Real A–N | Esperado A–N (sin supuestos) | Esperado A–N (bloques declarados) |',
);
console.log('|---|---|---|---|---|');
const det = m.logistica.votaciones.detalle;
const detB = new Map(
  m.logistica.conBloquesDeclaradosBayes.votaciones.detalle.map((x) => [x.id, x]),
);
for (const x of [...det].sort((a, b) => b.real[1] - a.real[1]).slice(0, 12)) {
  const b = detB.get(x.id);
  console.log(
    `| ${x.fecha} | ${x.titulo.slice(0, 70).replace(/\|/g, '/')} | ${x.real[0]}–${x.real[1]} | ${Math.round(x.esperado[0])}–${Math.round(x.esperado[1])} | ${b ? `${Math.round(b.esperado[0])}–${Math.round(b.esperado[1])}` : ''} |`,
  );
}
