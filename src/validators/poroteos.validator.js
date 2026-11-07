import { z } from 'zod';
import { pagination, searchText, uuidParams } from './common.js';
import { TIPOS_MAYORIA, VOTOS_POROTEO } from '../config/constants.js';

const titulo = z.string().trim().min(3, 'El título debe tener al menos 3 caracteres').max(300);
const descripcion = z.string().trim().max(5000).optional().nullable();
const textoProyecto = z.string().trim().max(500_000).optional().nullable();
const tipoMayoria = z.enum(TIPOS_MAYORIA);
const estado = z.enum(['borrador', 'final']);
const autor = z.string().trim().max(120).optional().nullable();
// BIGINT puede llegar como cadena. No aceptar números fuera del rango seguro de JS.
export const versionSchema = z.union([
  z.number().int().positive().safe(),
  z
    .string()
    .max(19)
    .refine((v) => /^[1-9]\d*$/.test(v) && BigInt(v) <= 9223372036854775807n),
]);
const rol = z.enum(['dueno', 'colaborador']);
export const versionBody = z.object({ version: versionSchema }).strict();
export const miembroParams = z
  .object({ id: z.string().uuid(), userId: z.string().uuid() })
  .strict();
export const agregarMiembroBody = z
  .object({
    version: versionSchema,
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    rol,
  })
  .strict();
export const cambiarRolBody = z.object({ version: versionSchema, rol }).strict();

/** Body de creación. Llega como JSON o como multipart/form-data (con PDF opcional). */
export const createPoroteoBody = z
  .object({
    titulo,
    descripcion,
    textoProyecto,
    tipoMayoria: tipoMayoria.default('simple'),
    autor,
  })
  .strict();

export const updatePoroteoBody = z
  .object({
    titulo,
    descripcion,
    textoProyecto,
    tipoMayoria,
    estado,
    autor,
    visibilidad: z.enum(['privado', 'publico']),
  })
  .partial()
  .extend({ version: versionSchema })
  .strict()
  .refine((body) => Object.keys(body).length > 1, { message: 'No hay campos para actualizar' });

export const poroteoParams = uuidParams;

export const listPoroteosQuery = z.object({
  q: searchText,
  page: pagination.page,
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const votoItem = z
  .object({
    diputadoId: z.coerce.number().int().positive(),
    voto: z.enum(VOTOS_POROTEO),
    // Campos preparados para la IA. En el poroteo manual no se envían.
    origen: z.enum(['manual', 'ia']).default('manual'),
    confianza: z.number().min(0).max(1).optional().nullable(),
    justificacion: z.string().trim().max(5000).optional().nullable(),
    fuentes: z.array(z.record(z.unknown())).max(50).optional().nullable(),
  })
  .strict();

/**
 * PUT /poroteos/:id/votos
 * modo "merge"   → actualiza solo los diputados enviados (por defecto)
 * modo "replace" → borra los votos previos y guarda solo los enviados
 */
export const putVotosBody = z
  .object({
    version: versionSchema,
    modo: z.enum(['merge', 'replace']).default('merge'),
    votos: z.array(votoItem).max(300),
  })
  .strict()
  .refine((body) => new Set(body.votos.map((v) => v.diputadoId)).size === body.votos.length, {
    message: 'Hay diputados repetidos en la lista de votos',
    path: ['votos'],
  });
