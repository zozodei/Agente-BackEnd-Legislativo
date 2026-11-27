import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

process.env.GEMINI_API_KEY = 'clave-de-prueba';
const { consultarEstructurado, proveedorLlm } = await import('../src/clients/llm.client.js');

const respuesta = (status, json) => ({ status, text: async () => JSON.stringify(json) });
afterEach(() => vi.unstubAllGlobals());

describe('cliente Gemini (gratis)', () => {
  it('elige Gemini, manda la clave por encabezado y valida el JSON', async () => {
    const llamadas = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, op = {}) => {
        llamadas.push({ url, op });
        if (url.includes('/models?'))
          return respuesta(200, {
            models: [
              { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
            ],
          });
        return respuesta(200, {
          candidates: [{ content: { parts: [{ text: '{"x": 3}' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
        });
      }),
    );
    expect(proveedorLlm()).toBe('gemini');
    const r = await consultarEstructurado({
      sistema: 's',
      usuario: { a: 1 },
      esquema: z.object({ x: z.number() }),
    });
    expect(r.datos).toEqual({ x: 3 });
    const gen = llamadas.find((l) => l.url.includes(':generateContent'));
    expect(gen.url).not.toContain('clave-de-prueba');
    expect(gen.op.headers['x-goog-api-key']).toBe('clave-de-prueba');
    expect(JSON.parse(gen.op.body).generationConfig.responseJsonSchema.properties.x.type).toBe(
      'number',
    );
  });

  it('si el modelo no acepta el esquema (400), lo pide en el texto y valida igual', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (url.includes('/models?')) return respuesta(200, { models: [] });
        n++;
        return n === 1
          ? respuesta(400, { error: { message: 'responseJsonSchema no soportado' } })
          : respuesta(200, {
              candidates: [{ content: { parts: [{ text: '```json\n{"x": 1}\n```' }] } }],
            });
      }),
    );
    const r = await consultarEstructurado({
      sistema: 's',
      usuario: 'u',
      esquema: z.object({ x: z.number() }),
    });
    expect(r.datos.x).toBe(1);
  });

  it('respuesta que no cumple el esquema → error (y el sistema sigue solo con datos)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        url.includes('/models?')
          ? respuesta(200, { models: [] })
          : respuesta(200, { candidates: [{ content: { parts: [{ text: '{"x": "no"}' }] } }] }),
      ),
    );
    await expect(
      consultarEstructurado({ sistema: 's', usuario: 'u', esquema: z.object({ x: z.number() }) }),
    ).rejects.toThrow();
  });
});
