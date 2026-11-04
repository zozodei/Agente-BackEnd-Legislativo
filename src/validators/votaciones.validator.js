import { z } from 'zod';
import { intIdParams, isoDate, pagination, queryBoolean, searchText } from './common.js';

export const listVotacionesQuery = z
  .object({
    q: searchText,
    desde: isoDate,
    hasta: isoDate,
    anio: z.coerce.number().int().min(1983).max(2100).optional(),
    resultado: z.enum(['AFIRMATIVO', 'NEGATIVO', 'EMPATE']).optional(),
    soloGeneral: queryBoolean.optional(),
    page: pagination.page,
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((q) => !q.desde || !q.hasta || q.desde <= q.hasta, {
    message: '"desde" no puede ser posterior a "hasta"',
    path: ['desde'],
  });

export const votacionParams = intIdParams;
