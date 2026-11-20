// Enfoques c) "solo LLM" y d) híbrido (modelo + LLM que redacta) sobre votaciones de prueba.
// Requiere ANTHROPIC_API_KEY. Cuesta dinero: por defecto usa pocas votaciones.
//   node --env-file=.env scripts/modelo/evaluar-llm.mjs [votaciones=6] [modelo=claude-opus-5-5]
// c) El LLM recibe, por diputado, el mismo historial que usa el modelo (votos en proyectos
//    parecidos, bloque, disciplina, ausencias) y devuelve probabilidades.
// d) Mide costo, latencia y validez de las explicaciones redactadas a partir de los factores.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { DIR_MODELO, leerJsonGz } from '../dataset/comun.mjs';
import { Historia, CLASES, diaDe } from '../../src/prediccion/historia.js';
import { MotorPrediccion } from '../../src/prediccion/motor.js';
import { calcularFeatures } from '../../src/prediccion/features.js';
import { contextoDeVotacion, sujetosDeVotacion } from './filas.mjs';
import { metricas } from './aprendizaje.mjs';
import { SISTEMA, datosParaLlm, validarTexto } from '../../src/services/explicaciones.service.js';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Falta ANTHROPIC_API_KEY: no se puede evaluar el LLM.');
  process.exit(1);
}
const N = Number(process.argv[2] ?? 6);
const MODELO = process.argv[3] ?? 'claude-opus-5-5';
const PRECIOS = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-4-5': [1, 5] };
const client = new Anthropic();
const historia = new Historia(leerJsonGz(join(DIR_MODELO, 'historia.json.gz')));
const motor = MotorPrediccion.cargar();

// Votaciones de prueba divididas (las difíciles), en general.
const candidatas = historia.votaciones
  .map((v, iv) => ({ v, iv }))
  .filter(({ v }) => v.dia >= diaDe('2024-07-01') && v.esGeneral && v.tipo === 'proyecto' && v.conteo[1] >= 60);
const elegidas = candidatas.filter((_, i) => i % Math.max(1, Math.floor(candidatas.length / N)) === 0).slice(0, N);

const Probs = z.object({
  predicciones: z.array(
    z.object({ id: z.string(), AFIRMATIVO: z.number(), NEGATIVO: z.number(), ABSTENCION: z.number(), AUSENTE: z.number() }),
  ),
});
const SISTEMA_C = `Estimás cómo votará cada diputado argentino un proyecto, SOLO con los datos dados (historial de votos en proyectos parecidos, bloque, disciplina, ausencias). Para cada id devolvé probabilidades (0 a 1, suman 1) de AFIRMATIVO, NEGATIVO, ABSTENCION, AUSENTE. No uses conocimiento externo.`;

const usoTotal = { c: { entrada: 0, salida: 0, ms: 0 }, d: { entrada: 0, salida: 0, ms: 0, validas: 0, total: 0 } };
const P = [];
const Y = [];
for (const { v, iv } of elegidas) {
  const ctx = contextoDeVotacion(historia, iv);
  const { sujetos, etiquetas } = sujetosDeVotacion(historia, iv);
  const { detalles } = calcularFeatures(historia, ctx, sujetos);
  const items = sujetos.map((s, i) => ({
    id: String(i),
    bloque: historia.bloques[s.grupo],
    votosEnParecidas: detalles[i].votosEnSimilares
      .filter((x) => x.voto !== null)
      .slice(0, 5)
      .map((x) => ({ titulo: historia.votaciones[x.iv].titulo.slice(0, 80), fecha: historia.votaciones[x.iv].fecha, voto: CLASES[x.voto] })),
    bloqueEnParecidas: Object.fromEntries(CLASES.map((c, k) => [c, Math.round(detalles[i].bloqueSim[k] * 100)])),
    acompanaAlBloque: Math.round(detalles[i].disciplina * 100),
    ausenteUltimas10: detalles[i].ausentesUltimas10,
  }));
  for (let i = 0; i < items.length; i += 40) {
    const t0 = Date.now();
    const r = await client.messages.parse({
      model: MODELO,
      max_tokens: 16000,
      output_config: { effort: 'low', format: zodOutputFormat(Probs) },
      system: [{ type: 'text', text: SISTEMA_C, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: JSON.stringify({ proyecto: v.titulo, fecha: v.fecha, diputados: items.slice(i, i + 40) }) }],
    });
    usoTotal.c.ms += Date.now() - t0;
    usoTotal.c.entrada += r.usage.input_tokens + (r.usage.cache_read_input_tokens ?? 0);
    usoTotal.c.salida += r.usage.output_tokens;
    const porId = new Map((r.parsed_output?.predicciones ?? []).map((p) => [p.id, p]));
    items.slice(i, i + 40).forEach((it) => {
      const p = porId.get(it.id);
      const arr = p ? CLASES.map((c) => Math.max(p[c], 1e-6)) : [0.25, 0.25, 0.25, 0.25];
      const s = arr.reduce((a, b) => a + b, 0);
      P.push(arr.map((x) => x / s));
      Y.push(etiquetas[Number(it.id)]);
    });
  }
  console.log(`c) ${v.fecha} ${v.titulo.slice(0, 60)} listo`);
}
const mc = metricas(P, Uint8Array.from(Y), CLASES);

// d) explicaciones para un poroteo real con los diputados actuales
const diputados = leerJsonGz(join(DIR_MODELO, '..', 'dataset', 'diputados_actuales.json.gz')).map((d) => ({
  id: d.id,
  personaId: d.persona_id,
  bloque: d.bloque_actual,
  nombreCompleto: `${d.apellido}, ${d.nombre}`,
}));
const pred = motor.predecir({ titulo: 'Ley de financiamiento universitario' }, diputados);
for (let i = 0; i < pred.predicciones.length; i += 20) {
  const lote = pred.predicciones.slice(i, i + 20).map((p, k) => ({ id: String(k), ...datosParaLlm(p.factores) }));
  const t0 = Date.now();
  const r = await client.messages.parse({
    model: MODELO,
    max_tokens: 16000,
    output_config: {
      effort: 'low',
      format: zodOutputFormat(z.object({ explicaciones: z.array(z.object({ id: z.string(), texto: z.string() })) })),
    },
    system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(lote) }],
  });
  usoTotal.d.ms = Math.max(usoTotal.d.ms, Date.now() - t0); // los lotes corren en paralelo en producción
  usoTotal.d.entrada += r.usage.input_tokens + (r.usage.cache_read_input_tokens ?? 0);
  usoTotal.d.salida += r.usage.output_tokens;
  for (const e of r.parsed_output?.explicaciones ?? []) {
    usoTotal.d.total++;
    if (validarTexto(e.texto, lote[Number(e.id)])) usoTotal.d.validas++;
  }
}
const [pin, pout] = PRECIOS[MODELO] ?? [0, 0];
const costo = (u) => (u.entrada * pin + u.salida * pout) / 1e6;
const resultado = {
  modelo: MODELO,
  votaciones: elegidas.map(({ v }) => ({ id: v.id, fecha: v.fecha, titulo: v.titulo })),
  c: { metricas: mc, costoUSDPorPoroteo: costo(usoTotal.c) / elegidas.length, segundosPorPoroteo: usoTotal.c.ms / 1000 / elegidas.length },
  d: { costoUSDPorPoroteo: costo(usoTotal.d), latenciaSegundos: usoTotal.d.ms / 1000, explicacionesValidas: `${usoTotal.d.validas}/${usoTotal.d.total}` },
};
writeFileSync(join(DIR_MODELO, 'evaluacion', `llm-${MODELO}.json`), JSON.stringify(resultado, null, 1));
console.log(JSON.stringify({ c: { accuracy: mc.accuracy, f1Macro: mc.f1Macro, logloss: mc.logloss, ...resultado.c, metricas: undefined }, d: resultado.d }, null, 1));
