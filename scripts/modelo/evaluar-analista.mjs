// Backtesting del ANALISTA DE BLOQUES con IA sobre votaciones reales que ni el modelo estadístico
// ni el LLM pudieron ver (por defecto: desde el 01/07/2026, posterior al conocimiento del LLM y al
// entrenamiento). Para cada votación, el LLM recibe solo el título, la fecha y datos previos.
//   node --env-file=.env scripts/modelo/evaluar-analista.mjs [desde=2026-07-01] [max=12] [soloDivididas=1]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { DIR_MODELO, leerJsonGz } from '../dataset/comun.mjs';
import { Historia, CLASES, diaDe } from '../../src/prediccion/historia.js';
import { calcularFeatures } from '../../src/prediccion/features.js';
import {
  predecirProbabilidades,
  aplicarPosturaBlanda,
  aplicarPosturaDeclarada,
  conAusenciaSinSupuestos,
} from '../../src/prediccion/modelo.js';
import { gobiernoEn } from '../../src/prediccion/gobiernos.js';
import { nombreTema } from '../../src/prediccion/proyecto.js';
import { contextoDeVotacion, sujetosDeVotacion, mayoriasReales } from './filas.mjs';
import { metricas } from './aprendizaje.mjs';
import { consultarEstructurado, llmDisponible } from '../../src/clients/llm.client.js';
import { SISTEMA_ANALISTA } from '../../src/services/analistaBloques.service.js';
import { tituloCorto, fechaCorta, nombreBloque } from '../../src/prediccion/explicacion.js';

if (!llmDisponible()) {
  console.error(
    'Falta GEMINI_API_KEY (gratis) o ANTHROPIC_API_KEY en el .env: el analista no se puede evaluar.',
  );
  process.exit(1);
}
const desde = process.argv[2] ?? '2026-07-01';
const max = Number(process.argv[3] ?? 12);
const soloDivididas = (process.argv[4] ?? '1') === '1';

const h = new Historia(leerJsonGz(join(DIR_MODELO, 'historia.json.gz')));
const modelo = leerJsonGz(join(DIR_MODELO, 'modelo.json.gz'));
console.log(
  `modelo estadístico entrenado hasta ${modelo.entrenamiento.hasta}; prueba desde ${desde}`,
);

const Salida = z.object({
  bloques: z.array(
    z.object({
      bloque: z.string(),
      AFIRMATIVO: z.number(),
      NEGATIVO: z.number(),
      ABSTENCION: z.number(),
      razon: z.string(),
    }),
  ),
  divideALaCamara: z.number(),
  resumen: z.string(),
});

// Las respuestas de la IA se guardan: re-evaluar otro método de combinación no vuelve a consultarla.
const rutaCache = join(DIR_MODELO, 'evaluacion', 'analista-respuestas.json');
const cacheRespuestas = existsSync(rutaCache) ? JSON.parse(readFileSync(rutaCache, 'utf8')) : {};
const Pm = [];
const elegidas = [];
for (let iv = 0; iv < h.votaciones.length; iv++) {
  const v = h.votaciones[iv];
  if (v.dia < diaDe(desde) || !v.esGeneral || v.tipo !== 'proyecto') continue;
  const [a, n] = v.conteo;
  if (soloDivididas && n < 0.2 * (a + n)) continue;
  elegidas.push(iv);
}
const muestra = elegidas.slice(-max);
const Pb = [];
const Pa = [];
const Pd = [];
const Y = [];
const porVotacion = [];
const tokens = { entrada: 0, salida: 0 };
for (const iv of muestra) {
  const v = h.votaciones[iv];
  const ctx = contextoDeVotacion(h, iv);
  const { sujetos, etiquetas } = sujetosDeVotacion(h, iv);
  const { X, detalles, vecinos, recientes, delTema } = calcularFeatures(h, ctx, sujetos);
  const base = X.map((x) => predecirProbabilidades(modelo, x));

  // contexto por bloque con datos previos a la votación
  const grupos = new Map();
  sujetos.forEach((s, i) => {
    if (!grupos.has(s.grupo)) grupos.set(s.grupo, []);
    grupos.get(s.grupo).push(i);
  });
  const bloques = [...grupos]
    .sort((x, y) => y[1].length - x[1].length)
    .map(([g, idx]) => {
      const d0 = detalles[idx[0]];
      const tema = { AFIRMATIVO: 0, NEGATIVO: 0, ABSTENCION: 0 };
      for (const i of idx)
        for (const t of detalles[i].votosEnTema)
          if (t.voto !== null && t.voto <= 2) tema[CLASES[t.voto]]++;
      return {
        grupo: g,
        bloque: nombreBloque(h.bloques[g] ?? ''),
        integrantes: idx.length,
        esOficialista: Boolean(d0.oficialista),
        coincidenciaConOficialismo: `${Math.round((idx.reduce((s, i) => s + detalles[i].alineacionOficialismo, 0) / idx.length) * 100)} %`,
        votosDeSusIntegrantesEnVotacionesParecidas: Object.fromEntries(
          CLASES.map((c, k) => [c, `${Math.round(d0.bloqueSim[k] * 100)} %`]),
        ),
        votosEnVotacionesDivididasDelMismoTema:
          tema.AFIRMATIVO + tema.NEGATIVO + tema.ABSTENCION ? tema : 'sin datos',
      };
    });
  const usuario = {
    proyecto: [v.nombreLey, v.titulo].filter(Boolean).join(' — '),
    fecha: v.fecha,
    gobierno: gobiernoEn(v.fecha),
    temaDetectado: nombreTema(v.tema),
    votacionesParecidas: vecinos.slice(0, 6).map(({ iv: j, sim }) => ({
      titulo: tituloCorto(h.votaciones[j].titulo, 100),
      fecha: fechaCorta(h.votaciones[j].fecha),
      resultado: `${h.votaciones[j].conteo[0]} a favor, ${h.votaciones[j].conteo[1]} en contra`,
      similitud: Math.round(sim * 100) / 100,
    })),
    votacionesDivididasDelMismoTema: delTema.map(({ iv: j }) => ({
      titulo: tituloCorto(h.votaciones[j].nombreLey ?? h.votaciones[j].titulo, 100),
      fecha: fechaCorta(h.votaciones[j].fecha),
      resultado: `${h.votaciones[j].conteo[0]} a favor, ${h.votaciones[j].conteo[1]} en contra`,
    })),
    bloques: bloques.map(({ grupo: _g, ...b }) => b),
  };
  const t0 = Date.now();
  const r =
    cacheRespuestas[v.id] ??
    (await consultarEstructurado({
      sistema: SISTEMA_ANALISTA,
      usuario,
      esquema: Salida,
      esfuerzo: 'medium',
      timeoutMs: 240_000,
    }).catch((error) => {
      console.log(`  ✗ ${v.fecha} ${v.nombreLey ?? v.titulo}: ${error.message} (se omite)`);
      return null;
    }));
  if (!r) continue;
  cacheRespuestas[v.id] = r;
  writeFileSync(rutaCache, JSON.stringify(cacheRespuestas));
  const ms = Date.now() - t0;
  tokens.entrada += r.uso.entrada;
  tokens.salida += r.uso.salida;
  const q = new Map();
  for (const b of r.datos.bloques) {
    const bl = bloques.find((x) => x.bloque.toLowerCase() === String(b.bloque).toLowerCase());
    if (bl)
      q.set(
        bl.grupo,
        [b.AFIRMATIVO, b.NEGATIVO, b.ABSTENCION].map((x) => Math.max(0, x)),
      );
  }
  // Método marginal: P = Σ_c q_c · P(voto | bloque vota c) con el modelo de posturas conocidas.
  const Xpor = [0, 1, 2].map((c) => {
    const posturas = new Map([...q.keys()].map((g) => [g, c]));
    return calcularFeatures(
      h,
      {
        ...ctx,
        posturasBloque: posturas,
        vecinos,
        vecinosRecientes: recientes,
        vecinosTema: delTema,
      },
      sujetos,
    ).X;
  });
  const reales = mayoriasReales(h, iv);
  const real = [0, 0, 0, 0];
  const esp = {
    base: [0, 0, 0, 0],
    analista: [0, 0, 0, 0],
    marginal: [0, 0, 0, 0],
    declarado: [0, 0, 0, 0],
  };
  sujetos.forEach((s, i) => {
    const pa = aplicarPosturaBlanda(base[i], q.get(s.grupo) ?? null, detalles[i].disciplina);
    const pd = aplicarPosturaDeclarada(
      base[i],
      reales.get(s.grupo) ?? null,
      detalles[i].disciplina,
    );
    const qq = q.get(s.grupo);
    let pm = base[i];
    if (qq) {
      const sq = qq[0] + qq[1] + qq[2] || 1;
      pm = [0, 0, 0, 0];
      for (let c = 0; c < 3; c++) {
        if (!qq[c]) continue;
        const pc = aplicarPosturaDeclarada(
          conAusenciaSinSupuestos(predecirProbabilidades(modelo, Xpor[c][i]), base[i]),
          c,
          detalles[i].disciplina,
        );
        for (let k = 0; k < 4; k++) pm[k] += (qq[c] / sq) * pc[k];
      }
    }
    Pm.push(pm);
    for (let k = 0; k < 4; k++) esp.marginal[k] += pm[k];
    Pb.push(base[i]);
    Pa.push(pa);
    Pd.push(pd);
    Y.push(etiquetas[i]);
    real[etiquetas[i]]++;
    for (let k = 0; k < 4; k++) {
      esp.base[k] += base[i][k];
      esp.analista[k] += pa[k];
      esp.declarado[k] += pd[k];
    }
  });
  const fila = {
    fecha: v.fecha,
    titulo: v.nombreLey ?? v.titulo,
    real: `${real[0]}–${real[1]}`,
    soloModelo: `${Math.round(esp.base[0])}–${Math.round(esp.base[1])}`,
    conAnalista: `${Math.round(esp.analista[0])}–${Math.round(esp.analista[1])}`,
    conAnalistaMarginal: `${Math.round(esp.marginal[0])}–${Math.round(esp.marginal[1])}`,
    conPosturasReales: `${Math.round(esp.declarado[0])}–${Math.round(esp.declarado[1])}`,
    segundos: Math.round(ms / 1000),
  };
  porVotacion.push(fila);
  console.log(fila);
}
const y = Uint8Array.from(Y);
const resumen = (P) => {
  const m = metricas(P, y, CLASES);
  return {
    accuracy: m.accuracy,
    f1Macro: m.f1Macro,
    logloss: m.logloss,
    ece: m.ece,
    f1Negativo: m.porClase[1].f1,
  };
};
const salida = {
  desde,
  votaciones: porVotacion.length,
  filas: Y.length,
  soloModelo: resumen(Pb),
  conAnalista: resumen(Pa),
  conAnalistaMarginal: resumen(Pm),
  conPosturasRealesTecho: resumen(Pd),
  modeloLlm: process.env.GEMINI_API_KEY ? 'gemini (gratis)' : 'anthropic',
  tokens,
  detalle: porVotacion,
};
writeFileSync(join(DIR_MODELO, 'evaluacion', 'analista.json'), JSON.stringify(salida, null, 1));
console.log(JSON.stringify({ ...salida, detalle: undefined }, null, 1));
