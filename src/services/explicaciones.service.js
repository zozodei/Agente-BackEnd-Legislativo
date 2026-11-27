// Explicaciones de las predicciones: plantilla determinista (siempre) + redacción opcional con LLM.
// Reglas: el LLM solo puede usar los datos que se le pasan; si cita un número o una votación que
// no está en los factores, se descarta su texto y queda la plantilla. Caché por hash de los datos.
import { createHash } from 'node:crypto';
import { logger } from '../config/logger.js';
import { explicacionesConLlm, redactarExplicaciones } from '../clients/llm.client.js';
import * as cacheRepository from '../repositories/explicaciones.repository.js';
import { fechaCorta, tituloCorto, nombreBloque } from '../prediccion/explicacion.js';

export const VERSION_PROMPT = 'v2';
// Lotes chicos en paralelo: menos latencia por llamada (la salida domina el tiempo).
const LOTE = 10;

export const SISTEMA = `Sos redactor de una ONG no partidista (Democracia en Red). Recibís un JSON con predicciones de voto de diputados argentinos y los datos que las sustentan. Para cada elemento escribí una explicación en español rioplatense neutro, de 2 a 4 oraciones.

Reglas obligatorias:
- Usá SOLO los datos del JSON. No inventes motivos, declaraciones, negociaciones, ideologías ni hechos.
- Citá datos concretos: cantidades, porcentajes y al menos una votación parecida con su título y fecha tal como aparecen.
- Copiá los números exactamente como vienen (por ejemplo "78 %"). No calcules números nuevos.
- No califiques ni opines sobre el legislador, su bloque o el proyecto. Mismo tono para todos los bloques.
- Si "pocosDatos" es true, decilo y aclarás que la confianza es baja.
- Si "sinVotacionesParecidas" es true, decí que no hay votaciones parecidas y apoyate en las votaciones divididas del mismo tema.
- Si hay "supuestos" del escenario, mencionalos como supuestos.
- No uses el género del legislador: evitá "él" / "ella" y adjetivos con género.
Devolvé un objeto { "explicaciones": [ { "id", "texto" } ] } con un elemento por cada id recibido.`;

const VOTO = {
  AFIRMATIVO: 'afirmativo',
  NEGATIVO: 'negativo',
  ABSTENCION: 'abstención',
  AUSENTE: 'ausente',
};
const pct = (x) => `${Math.round(x * 100)} %`;

/** Versión compacta y ya redondeada de los factores: es exactamente lo que el LLM puede citar. */
export function datosParaLlm(f) {
  const bloque = Object.fromEntries(
    Object.entries(f.bloque.enSimilares).map(([k, v]) => [VOTO[k], pct(v)]),
  );
  return {
    votoEstimado: VOTO[f.prediccion.voto],
    probabilidad: pct(f.prediccion.probabilidades[f.prediccion.voto]),
    votacionesParecidas: f.similares
      .filter((s) => s.voto)
      .slice(0, 5)
      .map((s) => ({
        titulo: tituloCorto(s.titulo),
        fecha: fechaCorta(s.fecha),
        suVoto: VOTO[s.voto],
        mayoriaDeSuBloque: s.mayoriaBloque ? VOTO[s.mayoriaBloque] : null,
      })),
    votacionesParecidasEnLasQueParticipo: f.similares.filter((s) => s.voto).length,
    bloque: { nombre: nombreBloque(f.bloque.nombre), votosDeSusIntegrantesEnParecidas: bloque },
    acompanoAlBloque: f.disciplina.base >= 10 ? pct(f.disciplina.porcentaje) : null,
    coincidenciaConOficialismo: f.oficialismo.base >= 20 ? pct(f.oficialismo.alineacion) : null,
    ausenteEnUltimas: `${f.ausentismo.ultimas10} de ${f.ausentismo.registradas}`,
    votacionesUltimosDosAnios: f.datos.votacionesUltimosDosAnios,
    pocosDatos: f.datos.pocosDatos,
    sinVotacionesParecidas: Boolean(f.antecedentes?.sinAntecedentes),
    votacionesDivididasDelMismoTema: (f.divididasDelTema ?? [])
      .filter((s) => s.voto)
      .slice(0, 4)
      .map((s) => ({
        titulo: tituloCorto(s.titulo),
        fecha: fechaCorta(s.fecha),
        suVoto: VOTO[s.voto],
      })),
    supuestos: {
      oficialismo: f.supuestos.oficialismo ? VOTO[f.supuestos.oficialismo] : null,
      bloque: f.supuestos.bloque ? VOTO[f.supuestos.bloque] : null,
    },
  };
}

export function claveCache(datos) {
  return createHash('sha256')
    .update(`${VERSION_PROMPT}|${JSON.stringify(datos)}`)
    .digest('hex');
}

const numeros = (texto) =>
  (String(texto).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));

/** El texto es válido si tiene 2–4 oraciones y todo número citado aparece en los datos. */
export function validarTexto(texto, datos) {
  if (!texto || texto.length < 40 || texto.length > 900) return false;
  const oraciones = texto
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿«"])/)
    .filter((o) => o.trim().length > 3);
  if (oraciones.length < 2 || oraciones.length > 4) return false;
  const permitidos = new Set(numeros(JSON.stringify(datos)));
  return numeros(texto).every((n) => permitidos.has(n));
}

/**
 * Completa `explicacion`, `explicacionFuente` y `explicacionEstado` de cada predicción.
 * Nunca falla: ante cualquier error del LLM queda la plantilla con estado 'error'.
 */
export async function completarExplicaciones(predicciones) {
  if (!explicacionesConLlm()) {
    for (const p of predicciones)
      Object.assign(p, { explicacionFuente: 'plantilla', explicacionEstado: 'sin_llm' });
    return { fuente: 'plantilla', llm: false };
  }
  const items = predicciones.map((p) => {
    const datos = datosParaLlm(p.factores);
    return { p, datos, clave: claveCache(datos) };
  });
  let enCache = new Map();
  try {
    enCache = await cacheRepository.fetchExplicaciones(items.map((i) => i.clave));
  } catch (error) {
    logger.warn({ err: error }, 'No se pudo leer la caché de explicaciones');
  }
  const pendientes = [];
  for (const it of items) {
    const texto = enCache.get(it.clave);
    if (texto)
      Object.assign(it.p, {
        explicacion: texto,
        explicacionFuente: 'llm',
        explicacionEstado: 'ok',
      });
    else pendientes.push(it);
  }
  let errores = 0;
  const nuevas = [];
  const lotes = [];
  for (let i = 0; i < pendientes.length; i += LOTE) lotes.push(pendientes.slice(i, i + LOTE));
  await Promise.all(
    lotes.map(async (lote) => {
      try {
        const { textos, modelo } = await redactarExplicaciones(
          SISTEMA,
          lote.map((it, k) => ({ id: String(k), ...it.datos })),
        );
        lote.forEach((it, k) => {
          const texto = textos.get(String(k));
          if (validarTexto(texto, it.datos)) {
            Object.assign(it.p, {
              explicacion: texto,
              explicacionFuente: 'llm',
              explicacionEstado: 'ok',
            });
            nuevas.push({ clave: it.clave, texto, modelo, version_prompt: VERSION_PROMPT });
          } else {
            errores++;
            Object.assign(it.p, { explicacionFuente: 'plantilla', explicacionEstado: 'error' });
          }
        });
      } catch (error) {
        logger.warn({ err: error }, 'Falló el LLM de explicaciones; se usan plantillas');
        errores += lote.length;
        for (const it of lote)
          Object.assign(it.p, { explicacionFuente: 'plantilla', explicacionEstado: 'error' });
      }
    }),
  );
  if (nuevas.length) {
    try {
      await cacheRepository.guardarExplicaciones(nuevas);
    } catch (error) {
      logger.warn({ err: error }, 'No se pudo guardar la caché de explicaciones');
    }
  }
  return {
    fuente: 'llm',
    llm: true,
    enCache: items.length - pendientes.length,
    generadas: nuevas.length,
    errores,
  };
}
