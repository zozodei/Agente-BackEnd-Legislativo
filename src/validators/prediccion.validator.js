import { z } from 'zod';
import { TIPOS_MAYORIA, VOTOS_POROTEO } from '../config/constants.js';
import { TEMAS } from '../prediccion/proyecto.js';
import { versionSchema } from './poroteos.validator.js';

const POSTURAS = ['AFIRMATIVO', 'NEGATIVO', 'ABSTENCION'];

/** Supuestos opcionales del escenario que el usuario declara antes de predecir. */
const supuestos = z
  .object({
    posturaOficialismo: z.enum(['AFIRMATIVO', 'NEGATIVO']).nullable().optional(),
    posturasBloque: z
      .record(z.string().trim().min(1).max(120), z.enum(POSTURAS))
      .refine((r) => Object.keys(r).length <= 40, 'Demasiados bloques')
      .optional(),
    tema: z.enum([...TEMAS.map((t) => t.id), 'otros']).optional(),
    tipo: z.enum(['proyecto', 'mocion']).optional(),
    dictamen: z.enum(['mayoria', 'minoria']).nullable().optional(),
    origenSenado: z.boolean().optional(),
    comoTemaDividido: z.boolean().optional(),
    solicitanteDiputadoId: z.number().int().positive().nullable().optional(),
  })
  .strict();

export const generarPrediccionBody = z
  .object({ version: versionSchema, supuestos: supuestos.optional() })
  .strict();

export const ajustesBody = z
  .object({
    version: versionSchema,
    ajustes: z
      .array(
        z
          .object({
            diputadoId: z.number().int().positive(),
            // null = volver a la predicción de la IA
            voto: z.enum(VOTOS_POROTEO).nullable(),
            motivo: z.string().trim().max(500).optional().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(257)
      .refine(
        (a) => new Set(a.map((x) => x.diputadoId)).size === a.length,
        'Hay diputados repetidos',
      ),
  })
  .strict();

export const analizarBody = z
  .object({
    titulo: z.string().trim().min(3, 'El título debe tener al menos 3 caracteres').max(1000),
    resumen: z.string().trim().max(5000).optional().nullable(),
    texto: z.string().trim().max(500_000).optional().nullable(),
  })
  .strict();

export const resultadoQuery = z
  .object({ tipoMayoria: z.enum(TIPOS_MAYORIA).default('simple') })
  .strict();
