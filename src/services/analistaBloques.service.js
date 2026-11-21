// Analista de bloques con IA: lee el proyecto y estima la postura de cada bloque (con
// probabilidades). El modelo estadístico después reparte esa postura diputado por diputado según
// su disciplina, historial y ausencias. Es lo que un estadístico no puede saber solo con votos
// pasados: qué postura van a tomar los bloques frente a un tema nuevo.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { llmDisponible, consultarEstructurado } from '../clients/llm.client.js';
import * as cacheRepository from '../repositories/explicaciones.repository.js';
import { tituloCorto, fechaCorta, nombreBloque } from '../prediccion/explicacion.js';

export const VERSION_ANALISTA = 'analista-v1';

export const SISTEMA_ANALISTA = `Sos analista parlamentario de una ONG no partidista (Democracia en Red). Tenés que estimar cómo votaría cada bloque de la Cámara de Diputados de la Nación Argentina la votación EN GENERAL del proyecto que se te da.

Para cada bloque estimá la probabilidad de que su mayoría vote AFIRMATIVO, NEGATIVO o ABSTENCION (las tres suman 1). Si esperás que el bloque se divida, repartí la probabilidad.

Cómo razonar:
- Leé el contenido del proyecto: qué cambia, a quién beneficia o afecta, si va en la línea del gobierno actual o en contra.
- Considerá las posiciones programáticas y antecedentes públicos conocidos de cada espacio político en temas afines, y su relación con el oficialismo.
- Usá los datos que se te dan: cómo votaron los integrantes ACTUALES de cada bloque en votaciones parecidas y en votaciones divididas del mismo tema, y su coincidencia con el oficialismo. Si tus conocimientos y los datos se contradicen, explicalo y no seas extremo.
- No uses el resultado de la votación de ESTE proyecto si lo conocieras: estimá como si todavía no se hubiera votado.
- Bloques chicos o provinciales: si no hay información, acercate a lo que dicen los datos y expresá incertidumbre (probabilidades menos extremas).

Reglas de neutralidad (obligatorias):
- No califiques ni opines sobre legisladores, partidos ni el proyecto. Describí posiciones, no las juzgues.
- No inventes declaraciones, citas, negociaciones ni hechos. La razón de cada bloque es una frase breve y verificable (contenido del proyecto, postura programática conocida o datos provistos).
- Mismo criterio y tono para todos los bloques.

Respondé solo con el JSON pedido, con una entrada por cada bloque recibido (mismo nombre).`;

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

const pct = (x) => Math.round(x * 100);

/** Contexto por bloque armado con los datos (a partir de una predicción base sin supuestos). */
export function contextoDeBloques(base, diputados) {
  const porBloque = new Map();
  base.predicciones.forEach((p, i) => {
    const b = diputados[i].bloque;
    if (!porBloque.has(b)) porBloque.set(b, []);
    porBloque.get(b).push(p.factores);
  });
  return [...porBloque]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([bloque, fs]) => {
      const f0 = fs[0];
      const tema = { AFIRMATIVO: 0, NEGATIVO: 0, ABSTENCION: 0, AUSENTE: 0 };
      for (const f of fs) for (const s of f.divididasDelTema ?? []) if (s.voto) tema[s.voto]++;
      const totalTema = tema.AFIRMATIVO + tema.NEGATIVO + tema.ABSTENCION;
      const alin = fs.reduce((s, f) => s + f.oficialismo.alineacion, 0) / fs.length;
      return {
        bloque: nombreBloque(bloque),
        clave: bloque,
        integrantes: fs.length,
        esOficialista: f0.oficialismo.esBloqueOficialista,
        coincidenciaConOficialismo: `${pct(alin)} %`,
        votosDeSusIntegrantesEnVotacionesParecidas: Object.fromEntries(
          Object.entries(f0.bloque.enSimilares).map(([k, v]) => [k, `${pct(v)} %`]),
        ),
        votosEnVotacionesDivididasDelMismoTema: totalTema
          ? Object.fromEntries(Object.entries(tema).map(([k, v]) => [k, v]))
          : 'sin datos',
      };
    });
}

/** Texto del proyecto para el analista (título + resumen + los primeros ~12.000 caracteres). */
function textoParaAnalista({ titulo, resumen, texto }) {
  return [titulo, resumen, String(texto ?? '').slice(0, 12_000)].filter(Boolean).join('\n\n');
}

/**
 * @returns {Promise<null | { bloques: Record<string, {postura, probabilidades, razon}>, divideALaCamara, resumen, modelo, deCache }>}
 * null si no hay LLM configurado o si falla (la predicción sigue solo con datos).
 */
export async function analizarBloques(entrada, base, diputados) {
  if (!llmDisponible()) return null;
  const bloques = contextoDeBloques(base, diputados);
  const usuario = {
    proyecto: textoParaAnalista(entrada),
    fecha: base.fecha,
    gobierno: base.gobierno,
    temaDetectado: base.proyecto.temaNombre,
    votacionesParecidas: [...base.similaresRecientes, ...base.similares]
      .filter((s, i, arr) => arr.findIndex((x) => x.votacionId === s.votacionId) === i)
      .slice(0, 6)
      .map((s) => ({
        titulo: tituloCorto(s.titulo, 100),
        fecha: fechaCorta(s.fecha),
        resultado: `${s.conteo.afirmativos} a favor, ${s.conteo.negativos} en contra`,
        similitud: s.similitud,
      })),
    votacionesDivididasDelMismoTema: (base.antecedentes?.divididasDelTema ?? []).map((s) => ({
      titulo: tituloCorto(s.nombreLey ?? s.titulo, 100),
      fecha: fechaCorta(s.fecha),
      resultado: `${s.conteo.afirmativos} a favor, ${s.conteo.negativos} en contra`,
    })),
    bloques: bloques.map(({ clave: _c, ...b }) => b),
  };
  const clave = `analisis:${createHash('sha256')
    .update(`${VERSION_ANALISTA}|${JSON.stringify(usuario)}`)
    .digest('hex')}`;

  let crudo = null;
  let deCache = false;
  try {
    const cache = await cacheRepository.fetchExplicaciones([clave]);
    if (cache.get(clave)) {
      crudo = JSON.parse(cache.get(clave));
      deCache = true;
    }
  } catch (error) {
    logger.warn({ err: error }, 'No se pudo leer la caché del analista');
  }
  let modelo = crudo?.modelo ?? null;
  if (!crudo) {
    try {
      const r = await consultarEstructurado({
        sistema: SISTEMA_ANALISTA,
        usuario,
        esquema: Salida,
        esfuerzo: 'medium',
        timeoutMs: env.LLM_TIMEOUT_ANALISTA_MS,
      });
      crudo = { ...r.datos, modelo: r.modelo };
      modelo = r.modelo;
      cacheRepository
        .guardarExplicaciones([
          {
            clave,
            texto: JSON.stringify(crudo),
            modelo: r.modelo,
            version_prompt: VERSION_ANALISTA,
          },
        ])
        .catch((error) => logger.warn({ err: error }, 'No se pudo guardar el análisis en caché'));
    } catch (error) {
      logger.warn({ err: error }, 'Falló el analista de bloques; se predice solo con datos');
      return null;
    }
  }

  // Normalizar y asociar cada respuesta con el nombre real del bloque.
  const porNombre = new Map(bloques.map((b) => [b.bloque.toLowerCase(), b.clave]));
  const salida = {};
  for (const b of crudo.bloques ?? []) {
    const claveReal = porNombre.get(String(b.bloque).toLowerCase());
    if (!claveReal) continue;
    const q = [b.AFIRMATIVO, b.NEGATIVO, b.ABSTENCION].map((x) => Math.max(0, Number(x) || 0));
    const s = q[0] + q[1] + q[2];
    if (!s) continue;
    const probabilidades = { AFIRMATIVO: q[0] / s, NEGATIVO: q[1] / s, ABSTENCION: q[2] / s };
    const postura = Object.entries(probabilidades).sort((x, y) => y[1] - x[1])[0][0];
    salida[claveReal] = { postura, probabilidades, razon: String(b.razon ?? '').slice(0, 400) };
  }
  if (!Object.keys(salida).length) return null;
  return {
    bloques: salida,
    divideALaCamara: Math.min(1, Math.max(0, Number(crudo.divideALaCamara) || 0)),
    resumen: String(crudo.resumen ?? '').slice(0, 800),
    modelo,
    deCache,
  };
}
