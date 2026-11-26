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
let modeloGemini = null;

async function fetchGemini(ruta, opciones = {}, timeoutMs = env.LLM_TIMEOUT_MS) {
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
  const json = texto ? JSON.parse(texto) : {};
  return { status: res.status, json };
}

/** Si el modelo configurado no existe, elige el "flash" más nuevo disponible para la clave. */
async function elegirModeloGemini() {
  if (modeloGemini) return modeloGemini;
  modeloGemini = env.GEMINI_MODELO;
  const { status, json } = await fetchGemini('/models?pageSize=200');
  if (status === 200) {
    const nombres = (json.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
    if (!nombres.includes(modeloGemini)) {
      const flash = nombres
        .filter((n) => /flash/.test(n) && !/lite|image|tts|live|exp/.test(n))
        .sort()
        .reverse();
      if (flash.length) modeloGemini = flash[0];
      logger.warn(
        { configurado: env.GEMINI_MODELO, elegido: modeloGemini },
        'Modelo Gemini no disponible: se usa otro',
      );
    }
  }
  return modeloGemini;
}

async function consultarGemini({ sistema, usuario, esquema, timeoutMs }) {
  const modelo = await elegirModeloGemini();
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
              : `${usuario}\n\nRespondé SOLO con un JSON que cumpla este esquema:\n${JSON.stringify(jsonSchema)}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      ...(conEsquema ? { responseJsonSchema: jsonSchema } : {}),
    },
  });
  const ruta = `/models/${encodeURIComponent(modelo)}:generateContent`;
  let r = await fetchGemini(
    ruta,
    { method: 'POST', body: JSON.stringify(cuerpo(true)) },
    timeoutMs ?? env.LLM_TIMEOUT_MS,
  );
  // Algunos modelos no aceptan el esquema en la configuración: se pide en el texto y se valida igual.
  if (r.status === 400) {
    r = await fetchGemini(
      ruta,
      { method: 'POST', body: JSON.stringify(cuerpo(false)) },
      timeoutMs ?? env.LLM_TIMEOUT_MS,
    );
  }
  if (r.status !== 200) {
    throw new Error(
      `Gemini respondió ${r.status}: ${r.json?.error?.message ?? 'error desconocido'}`,
    );
  }
  const texto = (r.json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (!texto)
    throw new Error(
      `Gemini no devolvió texto (${r.json.candidates?.[0]?.finishReason ?? 'sin candidato'})`,
    );
  const limpio = texto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const datos = esquema.parse(JSON.parse(limpio));
  return {
    datos,
    uso: {
      entrada: r.json.usageMetadata?.promptTokenCount ?? 0,
      salida: r.json.usageMetadata?.candidatesTokenCount ?? 0,
    },
    modelo,
  };
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
