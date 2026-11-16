import { z } from 'zod';

/**
 * Respuesta del servicio de predicción (ml/). Se valida como cualquier entrada externa:
 * el backend no confía en el servicio para el formato, los IDs ni los rangos.
 * Contrato completo: docs/prediccion.md.
 */
const prob = z.number().min(0).max(1);
const conteoEsperado = z.number().min(0).max(257);
const rango = z.tuple([conteoEsperado, conteoEsperado]).refine(([a, b]) => a <= b, {
  message: 'El intervalo debe ser [mínimo, máximo]',
});

export const VOTOS_PREDICHOS = ['AFIRMATIVO', 'NEGATIVO', 'ABSTENCION', 'AUSENTE'];

const votoPredicho = z
  .object({
    diputadoId: z.number().int().positive(),
    voto: z.enum(VOTOS_PREDICHOS),
    probabilidades: z
      .object({ AFIRMATIVO: prob, NEGATIVO: prob, ABSTENCION: prob, AUSENTE: prob })
      .strict()
      .refine((p) => Math.abs(p.AFIRMATIVO + p.NEGATIVO + p.ABSTENCION + p.AUSENTE - 1) < 0.02, {
        message: 'Las probabilidades deben sumar 1',
      }),
    confianza: prob,
    justificacion: z.string().trim().max(1000).nullable().default(null),
    fuentes: z.array(z.record(z.string(), z.unknown())).max(20).nullable().default(null),
  })
  .strict();

export const prediccionServicioSchema = z
  .object({
    modelo: z
      .object({
        nombre: z.string().max(100),
        version: z.string().max(100),
        variante: z.string().max(100).nullable().default(null),
        simulado: z.boolean().default(false),
        datosHasta: z.string().max(40).nullable().default(null),
      })
      .strict(),
    tema: z
      .object({
        valor: z.string().max(100).nullable(),
        origen: z.enum(['titulo', 'texto', 'usuario', 'desconocido']),
      })
      .strict()
      .nullable()
      .default(null),
    votos: z.array(votoPredicho).max(300),
    resumen: z
      .object({
        esperados: z
          .object({
            afirmativos: conteoEsperado,
            negativos: conteoEsperado,
            abstenciones: conteoEsperado,
            ausentes: conteoEsperado,
          })
          .strict(),
        intervalo80: z
          .object({ afirmativos: rango, negativos: rango })
          .strict()
          .nullable()
          .default(null),
        probAprobacion: prob.nullable().default(null),
        probQuorum: prob.nullable().default(null),
        probDividida: prob.nullable().default(null),
        posibleDividida: z.boolean().nullable().default(null),
      })
      .strict(),
    advertencias: z.array(z.string().max(500)).max(20).default([]),
  })
  .strict();
