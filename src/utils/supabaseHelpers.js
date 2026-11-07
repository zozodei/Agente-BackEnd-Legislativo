import { AppError } from './AppError.js';
import { logger } from '../config/logger.js';
import { POSTGREST_MAX_ROWS } from '../config/constants.js';

/** Códigos de Postgres / PostgREST que indican que falta una tabla o función. */
const MISSING_RELATION_CODES = new Set(['42P01', 'PGRST205', 'PGRST202', '42883']);

export function isMissingRelation(error) {
  return Boolean(error && MISSING_RELATION_CODES.has(error.code));
}

/**
 * supabase-js NO lanza excepciones: devuelve { data, error }.
 * Este helper lanza un AppError si hubo error y devuelve { data, count }.
 */
export function unwrap({ data, error, count }, contexto = 'consulta') {
  if (error) {
    logger.error({ code: error.code, contexto }, 'Error de Supabase');
    if (isMissingRelation(error)) {
      throw AppError.unavailable(
        'Falta una tabla o función en la base. ¿Se aplicaron las migraciones de supabase/migrations?',
        { contexto },
      );
    }
    throw AppError.upstream(undefined, { contexto });
  }
  return { data, count };
}

/**
 * Trae TODAS las filas paginando de a 1000 (límite de PostgREST).
 * `buildQuery(from, to)` debe devolver la query con `.range(from, to)` aplicado.
 */
export async function fetchAll(buildQuery, contexto, pageSize = POSTGREST_MAX_ROWS) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data } = unwrap(await buildQuery(from, from + pageSize - 1), contexto);
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

/**
 * Limpia un texto de búsqueda para usarlo dentro de filtros `ilike` / `.or()` de PostgREST:
 * escapa comodines y saca caracteres que rompen la sintaxis del filtro.
 */
export function sanitizeSearch(text) {
  return text
    .replace(/[%_\\]/g, (c) => `\\${c}`)
    .replace(/[,()*:"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
