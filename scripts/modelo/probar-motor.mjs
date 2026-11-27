// Prueba manual del motor con los 257 diputados actuales del export.
//   node scripts/modelo/probar-motor.mjs "Título del proyecto" [AFIRMATIVO|NEGATIVO]
import { leerRaw } from '../dataset/comun.mjs';
import { MotorPrediccion } from '../../src/prediccion/motor.js';

const t0 = Date.now();
const motor = MotorPrediccion.cargar();
console.log(`motor ${motor.version} cargado en ${Date.now() - t0} ms`);
const bloques = new Map(leerRaw('bloques').map((b) => [b.id, b.nombre]));
const diputados = leerRaw('diputados').map((d) => ({
  id: d.id,
  personaId: d.cv_persona_id,
  bloque: bloques.get(d.bloque_id),
  nombreCompleto: `${d.apellido}, ${d.nombre}`,
}));
const titulo =
  process.argv[2] ??
  'Modificación de la ley de financiamiento universitario y actualización de salarios docentes';
const t1 = Date.now();
const r = motor.predecir({ titulo, posturaOficialismo: process.argv[3] }, diputados);
console.log(
  `predicción en ${Date.now() - t1} ms · tema ${r.proyecto.temaNombre} · esperados`,
  r.resumen.esperados,
  'por voto',
  r.resumen.porVoto,
  'confianza',
  r.resumen.nivelConfianza,
);
console.log(
  'similares:',
  r.similares.slice(0, 3).map((s) => `${s.similitud} ${s.fecha} ${s.titulo.slice(0, 60)}`),
);
const porBloque = new Map();
for (const [i, p] of r.predicciones.entries()) {
  const b = diputados[i].bloque;
  if (!porBloque.has(b)) porBloque.set(b, { A: 0, N: 0, B: 0, U: 0 });
  porBloque.get(b)['ANBU'[['AFIRMATIVO', 'NEGATIVO', 'ABSTENCION', 'AUSENTE'].indexOf(p.voto)]]++;
}
console.log(
  [...porBloque]
    .sort(
      (a, b) =>
        Object.values(b[1]).reduce((x, y) => x + y) - Object.values(a[1]).reduce((x, y) => x + y),
    )
    .slice(0, 8)
    .map(([b, c]) => `${b}: ${JSON.stringify(c)}`)
    .join('\n'),
);
for (const i of [0, 50, 120])
  console.log(
    '\n',
    diputados[i].nombreCompleto,
    '|',
    diputados[i].bloque,
    '|',
    r.predicciones[i].voto,
    r.predicciones[i].nivelConfianza,
    '\n ',
    r.predicciones[i].explicacion,
  );
