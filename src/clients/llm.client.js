// Cliente del LLM (opcional): analista de bloques y redacción de explicaciones.
// Proveedores:
//   - Gemini (Google AI Studio, plan GRATUITO, sin tarjeta) → GEMINI_API_KEY
//   - Claude (Anthropic, pago)                               → ANTHROPIC_API_KEY
// Sin ninguna clave, el sistema funciona igual: predicción solo con datos y explicaciones por plantilla.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/** Proveedor activo: el explícito en LLM_PROVEEDOR o el primero con clave (Gemini primero: es gratis). */
export function proveedorLlm() {
  if (env.LLM_PROVEEDOR === 'gemini' && env.GEMINI_API_KEY) return 'gemini';
  if (env.LLM_PROVEEDOR === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.GEMINI_API_KEY) return 'gemini';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

export function llmDisponible() {
  return proveedorLlm() !== null;
}

/** ¿Redactar las explicaciones con LLM? (con Gemini gratis, por defecto no: ver env.js) */
export function explicacionesConLlm() {
  if (env.LLM_EXPLICACIONES === 'no') return false;
  if (env.LLM_EXPLICACIONES === 'si') return llmDisponible();
  return proveedorLlm() === 'anthropic';
}

// ------------------------------------------------------------------ Anthropic
let clienteAnthropic = null;
function anthropic() {
  if (!clienteAnthropic) {
    clienteAnthropic = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      timeout: env.LLM_TIMEOUT_MS,
      maxRetries: 1,
    });
  }
  return clienteAnthropic;
}

async function consultarAnthropic({ sistema, usuario, esquema, esfuerzo, timeoutMs }) {
  const respuesta = await anthropic().messages.parse(
    {
      model: env.LLM_MODELO,
      max_tokens: 16000,
      output_config: { effort: esfuerzo, format: zodOutputFormat(esquema) },
      system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: usuario }],
    },
    timeoutMs ? { timeout: timeoutMs } : undefined,
  );
  if (respuesta.stop_reason === 'refusal' || !respuesta.parsed_output) {
    throw new Error(`El LLM no devolvió una respuesta válida (${respuesta.stop_reason})`);
  }
  return {
    datos: respuesta.parsed_output,
    uso: { entrada: respuesta.usage.input_tokens, salida: respuesta.usage.output_tokens },
    modelo: respuesta.model,
  };
}

// ------------------------------------------------------------------ Gemini (gratis)
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta';
let modelosGemini = null;

async function fetchGemini(ruta, opciones = {}, timeoutMs = env.LLM_TIMEOUT_MS) {
  try {
    const res = await fetch(`${GEMINI_URL}${ruta}`, {
      ...opciones,
      // La clave va en un encabezado, nunca en la URL (no queda en logs).
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
        ...opciones.headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const texto = await res.text();
    let json = {};
    try {
      json = texto ? JSON.parse(texto) : {};
    } catch {
      json = { error: { message: texto.slice(0, 200) } };
    }
    return { status: res.status, json };
  } catch (error) {
    // timeout o red caída: se trata como "servicio no disponible" para probar otro modelo
    return { status: 599, json: { error: { message: String(error?.message ?? error) } } };
  }
}

/**
 * Modelos a probar, en orden: el configurado y, de respaldo, otros "flash" del plan gratuito
 * (el plan gratis a veces responde 503 "alta demanda" en un modelo y no en otro).
 */
async function modelosDisponibles() {
  if (modelosGemini) return modelosGemini;
  const preferidos = [
    env.GEMINI_MODELO,
    'gemini-flash-latest',
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
  ];
  const { status, json } = await fetchGemini('/models?pageSize=200');
  const existentes =
    status === 200
      ? new Set(
          (json.models ?? [])
            .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
            .map((m) => m.name.replace(/^models\//, '')),
        )
      : null;
  modelosGemini = [...new Set(preferidos)].filter((m) => !existentes || existentes.has(m));
  if (!modelosGemini.length) modelosGemini = [env.GEMINI_MODELO];
  return modelosGemini;
}

const REINTENTABLE = new Set([429, 500, 503, 599]);

/** Reintenta 429/5xx con espera creciente (el plan gratis limita pedidos por minuto). */
async function conReintentos(pedido, intentos = 3) {
  for (let intento = 0; ; intento++) {
    const r = await pedido();
    if (!REINTENTABLE.has(r.status) || intento >= intentos - 1) return r;
    const espera = 10_000 * (intento + 1);
    logger.warn({ status: r.status, espera }, 'Gemini no disponible por el momento, se reintenta');
    await new Promise((res) => setTimeout(res, espera));
  }
}

async function consultarGemini({ sistema, usuario, esquema, esfuerzo, timeoutMs }) {
  const jsonSchema = z.toJSONSchema(esquema, { target: 'draft-7' });
  const cuerpo = (conEsquema) => ({
    systemInstruction: { parts: [{ text: sistema }] },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: conEsquema
              ? usuario
              : `${usuario}

Respondé SOLO con un JSON que cumpla este esquema:
${JSON.stringify(jsonSchema)}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: esfuerzo === 'low' ? 'low' : 'medium' },
      responseMimeType: 'application/json',
      ...(conEsquema ? { responseJsonSchema: jsonSchema } : {}),
    },
  });
  const limite = timeoutMs ?? env.LLM_TIMEOUT_MS;
  let ultimo = null;
  for (const modelo of await modelosDisponibles()) {
    const ruta = `/models/${encodeURIComponent(modelo)}:generateContent`;
    const pedir = (conEsquema) => () =>
      fetchGemini(ruta, { method: 'POST', body: JSON.stringify(cuerpo(conEsquema)) }, limite);
    let r = await conReintentos(pedir(true));
    // Algunos modelos no aceptan el esquema en la configuración: se pide en el texto y se valida igual.
    if (r.status === 400) r = await conReintentos(pedir(false));
    if (r.status === 200) {
      const texto = (r.json.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? '')
        .join('');
      if (!texto) {
        ultimo = new Error(
          `Gemini no devolvió texto (${r.json.candidates?.[0]?.finishReason ?? 'sin candidato'})`,
        );
        continue;
      }
      const limpio = texto
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/, '')
        .trim();
      return {
        datos: esquema.parse(JSON.parse(limpio)),
        uso: {
          entrada: r.json.usageMetadata?.promptTokenCount ?? 0,
          salida: r.json.usageMetadata?.candidatesTokenCount ?? 0,
        },
        modelo,
      };
    }
    ultimo = new Error(
      `Gemini (${modelo}) respondió ${r.status}: ${r.json?.error?.message ?? 'error desconocido'}`,
    );
    logger.warn({ modelo, status: r.status }, 'Gemini: se prueba con otro modelo');
  }
  throw ultimo ?? new Error('Gemini no está disponible');
}

// ------------------------------------------------------------------ API común
/**
 * Consulta con salida JSON validada por un esquema zod.
 * @returns {Promise<{ datos: object, uso: { entrada: number, salida: number }, modelo: string }>}
 */
export async function consultarEstructurado({
  sistema,
  usuario,
  esquema,
  esfuerzo = 'low',
  timeoutMs,
}) {
  const texto = typeof usuario === 'string' ? usuario : JSON.stringify(usuario);
  const proveedor = proveedorLlm();
  if (!proveedor) throw new Error('No hay ningún LLM configurado');
  const consulta = proveedor === 'gemini' ? consultarGemini : consultarAnthropic;
  return consulta({ sistema, usuario: texto, esquema, esfuerzo, timeoutMs });
}

const SalidaExplicaciones = z.object({
  explicaciones: z.array(z.object({ id: z.string(), texto: z.string() })),
});

/** Redacta explicaciones para un lote de predicciones. */
export async function redactarExplicaciones(sistema, lote) {
  const r = await consultarEstructurado({ sistema, usuario: lote, esquema: SalidaExplicaciones });
  return {
    textos: new Map(r.datos.explicaciones.map((e) => [e.id, e.texto.trim()])),
    uso: r.uso,
    modelo: r.modelo,
  };
}
