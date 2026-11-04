import { z } from 'zod';
import { intIdParams, pagination, queryBoolean, searchText } from './common.js';
import { VOTOS_REALES } from '../config/constants.js';

export const listDiputadosQuery = z.object({
  q: searchText,
  bloque: z.string().trim().max(120).optional(),
  distrito: z.string().trim().max(60).optional(),
  orden: z.enum(['apellido', 'bloque', 'distrito', 'presentismo']).default('apellido'),
  page: pagination.page,
  // Por defecto devuelve los 257 de una vez (útil para el hemiciclo).
  pageSize: z.coerce.number().int().min(1).max(300).default(300),
});

export const diputadoParams = intIdParams;

export const votosDiputadoQuery = z.object({
  q: searchText,
  voto: z.enum(VOTOS_REALES).optional(),
  anio: z.coerce.number().int().min(1983).max(2100).optional(),
  soloGeneral: queryBoolean.optional(),
  page: pagination.page,
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
