import { supabaseAdmin } from '../config/supabase.js';
import { fetchAll, sanitizeSearch, unwrap } from '../utils/supabaseHelpers.js';
import { toRange } from '../utils/pagination.js';
import { AppError } from '../utils/AppError.js';

function miembro(query, userId) {
  if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Se requiere iniciar sesión');
  return query.eq('membresia.user_id', userId);
}

const POROTEO_COLUMNS =
  'id,titulo,descripcion,archivo_nombre,camara,tipo_mayoria,estado,origen,autor,metadata,created_at,updated_at,visibilidad,version';
const MEMBRESIA = ',membresia:poroteo_usuarios!inner(rol)';

/** Conteo exacto para el panel de consulta, sin descargar todos los poroteos. */
export async function countPoroteos(estado) {
  let query = supabaseAdmin.from('poroteos').select('id', { count: 'exact', head: true });
  if (estado) query = query.eq('estado', estado);
  const { count } = unwrap(await query, 'admin.poroteos.count');
  if (!Number.isInteger(count) || count < 0) {
    throw AppError.upstream('No se pudo verificar el total de poroteos');
  }
  return count;
}

/** @returns {Promise<Array<import('../entities/PoroteoVoto.js').default>>} */
export async function fetchVotos(poroteoIds) {
  if (!poroteoIds.length) return [];
  return fetchAll(
    (from, to) =>
      supabaseAdmin
        .from('poroteo_votos')
        .select('poroteo_id,diputado_id,voto,origen,confianza,justificacion,fuentes,updated_at')
        .in('poroteo_id', poroteoIds)
        .order('poroteo_id')
        .order('diputado_id')
        .range(from, to),
    'poroteos.votos',
  );
}

/**
 * @param {Partial<import('../entities/Poroteo.js').default>} row
 * @returns {Promise<Omit<import('../entities/Poroteo.js').default, 'texto_proyecto'>>}
 */
export async function insertPoroteo(row) {
  if (!row.user_id) throw new AppError(401, 'UNAUTHORIZED', 'Se requiere iniciar sesión');
  return unwrap(
    await supabaseAdmin.from('poroteos').insert(row).select(POROTEO_COLUMNS).single(),
    'poroteos.create',
  ).data;
}

/** @returns {Promise<{data: Array<Omit<import('../entities/Poroteo.js').default, 'texto_proyecto'>>, count: number | null | undefined}>} */
export function fetchPoroteos(params, userId) {
  return listar(params, (query) => miembro(query, userId), MEMBRESIA);
}

export function fetchPoroteosPublicos(params) {
  return listar(params, (query) => query.eq('visibilidad', 'publico'));
}

// Exclusivo del service administrativo protegido. Nunca usar como fallback.
export function fetchPoroteosGlobal(params) {
  return listar(params, (query) => query);
}

async function listar({ q, page, pageSize }, scope, extra = '') {
  const { from, to } = toRange(page, pageSize);
  let query = scope(
    supabaseAdmin.from('poroteos').select(POROTEO_COLUMNS + extra, { count: 'exact' }),
  );
  if (q) {
    const term = sanitizeSearch(q);
    if (term) query = query.ilike('titulo', `%${term}%`);
  }
  const { data, count } = unwrap(
    await query.order('updated_at', { ascending: false }).order('id').range(from, to),
    'poroteos.list',
  );

  return { data, count };
}

/** @returns {Promise<import('../entities/Poroteo.js').default | null>} */
export function fetchPoroteo(id, userId) {
  return obtener(id, (query) => miembro(query, userId), MEMBRESIA);
}

export function fetchPoroteoPublico(id) {
  return obtener(id, (query) => query.eq('visibilidad', 'publico'));
}

export function fetchPoroteoGlobal(id) {
  return obtener(id, (query) => query);
}

async function obtener(id, scope, extra = '') {
  const { data: row } = unwrap(
    await scope(
      supabaseAdmin
        .from('poroteos')
        .select(`${POROTEO_COLUMNS},texto_proyecto${extra}`)
        .eq('id', id),
    ).maybeSingle(),
    'poroteos.get',
  );
  return row;
}

/** Única vía de mutación luego de crear: la RPC autoriza y bloquea en una transacción. */
export async function mutarPoroteo(id, actorId, version, accion, datos = {}) {
  if (!actorId) throw new AppError(401, 'UNAUTHORIZED', 'Se requiere iniciar sesión');
  const result = await supabaseAdmin.rpc('poroteo_mutar', {
    p_poroteo_id: id,
    p_actor_id: actorId,
    p_version: version,
    p_accion: accion,
    p_datos: datos,
  });
  const error = result.error;
  if (error) {
    const known = {
      PT401: [401, 'UNAUTHORIZED', 'Se requiere iniciar sesión'],
      PT404: [404, 'NOT_FOUND', 'Poroteo o participante no encontrado'],
      PT403: [403, 'FORBIDDEN', 'Esta operación requiere ser dueño del poroteo'],
      PT409: [
        409,
        'VERSION_CONFLICT',
        'Otra persona modificó el poroteo. Conservá tus cambios y revisalos antes de recargar.',
      ],
      PT400: [400, 'BAD_REQUEST', 'Los datos de la operación no son válidos'],
      23505: [409, 'MEMBER_EXISTS', 'La cuenta ya participa en este poroteo'],
      23503: [400, 'BAD_REQUEST', 'La cuenta o el diputado indicado ya no existe'],
      23502: [400, 'BAD_REQUEST', 'Faltan datos obligatorios'],
      '22P02': [400, 'BAD_REQUEST', 'Hay datos con formato inválido'],
      22003: [400, 'BAD_REQUEST', 'Hay valores fuera del rango permitido'],
    };
    if (error.code === '23514') {
      if (error.message?.includes('ULTIMO_DUENO')) {
        throw new AppError(409, 'LAST_OWNER', 'Debe quedar al menos un dueño en el poroteo');
      }
      throw AppError.badRequest('Los datos no cumplen las reglas del poroteo');
    }
    if (known[error.code]) throw new AppError(...known[error.code]);
  }
  return unwrap(result, 'poroteos.mutar').data;
}

/** @returns {Promise<Array<import('../entities/PoroteoUsuario.js').default>>} */
export function fetchMiembros(id) {
  return fetchAll(
    (from, to) =>
      supabaseAdmin
        .from('poroteo_usuarios')
        .select('poroteo_id,user_id,rol,created_at')
        .eq('poroteo_id', id)
        .order('created_at')
        .order('user_id')
        .range(from, to),
    'poroteos.miembros',
  );
}
