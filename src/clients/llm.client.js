// Cliente del LLM que redacta explicaciones (opcional). Sin ANTHROPIC_API_KEY no se usa y el
// sistema sigue funcionando con las explicaciones por plantilla.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { env } from '../config/env.js';

let cliente = null;

export function llmDisponible() {
  return Boolean(env.ANTHROPIC_API_KEY);
}

function getCliente() {
  if (!cliente) {
    cliente = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      timeout: env.LLM_TIMEOUT_MS,
      maxRetries: 1,
    });
  }
  return cliente;
}

const Salida = z.object({
  explicaciones: z.array(z.object({ id: z.string(), texto: z.string() })),
});

/**
 * Redacta explicaciones para un lote de predicciones.
 * @param {string} sistema  instrucciones fijas (se cachean)
 * @param {Array<{id: string, factores: object}>} lote
 * @returns {Promise<{ textos: Map<string,string>, uso: object, modelo: string }>}
 */
export async function redactarExplicaciones(sistema, lote) {
  const respuesta = await getCliente().messages.parse({
    model: env.LLM_MODELO,
    max_tokens: 16000,
    output_config: { effort: 'low', format: zodOutputFormat(Salida) },
    system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(lote) }],
  });
  if (respuesta.stop_reason === 'refusal' || !respuesta.parsed_output) {
    throw new Error(`El LLM no devolvió explicaciones (${respuesta.stop_reason})`);
  }
  return {
    textos: new Map(respuesta.parsed_output.explicaciones.map((e) => [e.id, e.texto.trim()])),
    uso: respuesta.usage,
    modelo: respuesta.model,
  };
}
