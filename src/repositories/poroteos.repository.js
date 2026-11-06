import { supabaseAdmin } from '../config/supabase.js';
import { fetchAll, sanitizeSearch, unwrap } from '../utils/supabaseHelpers.js';
import { toRange } from '../utils/pagination.js';
import { AppError } from '../utils/AppError.js';

function propietario(query, userId) {
  if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Se requiere iniciar sesión');
  return query.eq('user_id', userId);
}

const POROTEO_COLUMNS =
  'id,titulo,descripcion,archivo_nombre,camara,tipo_mayoria,estado,origen,autor,metadata,created_at,updated_at';

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
  return listar(params, (query) => propietario(query, userId));
}

// Exclusivo del service administrativo protegido. Nunca usar como fallback.
export function fetchPoroteosGlobal(params) {
  return listar(params, (query) => query);
}

async function listar({ q, page, pageSize }, scope) {
  const { from, to } = toRange(page, pageSize);
  let query = scope(supabaseAdmin.from('poroteos').select(POROTEO_COLUMNS, { count: 'exact' }));
  if (q) {
    const term = sanitizeSearch(q);
    if (term) query = query.ilike('titulo', `%${term}%`);
  }
  const { data, count } = unwrap(
    await query.order('updated_at', { ascending: false }).range(from, to),
    'poroteos.list',
  );

  return { data, count };
}

/** @returns {Promise<import('../entities/Poroteo.js').default | null>} */
export function fetchPoroteo(id, userId) {
  return obtener(id, (query) => propietario(query, userId));
}

export function fetchPoroteoGlobal(id) {
  return obtener(id, (query) => query);
}

async function obtener(id, scope) {
  const { data: row } = unwrap(
    await scope(
      supabaseAdmin.from('poroteos').select(`${POROTEO_COLUMNS},texto_proyecto`).eq('id', id),
    ).maybeSingle(),
    'poroteos.get',
  );
  return row;
}

/**
 * @param {string} id
 * @param {Partial<import('../entities/Poroteo.js').default>} patch
 * @returns {Promise<Array<Pick<import('../entities/Poroteo.js').default, 'id'>>>}
 */
export async function updatePoroteo(id, patch, userId) {
  const { data } = unwrap(
    await propietario(supabaseAdmin.from('poroteos').update(patch).eq('id', id), userId).select(
      'id',
    ),
    'poroteos.update',
  );
  return data;
}

/** @returns {Promise<Pick<import('../entities/Poroteo.js').default, 'id'> | null>} */
export async function fetchPoroteoId(id, userId) {
  const { data: existe } = unwrap(
    await propietario(
      supabaseAdmin.from('poroteos').select('id').eq('id', id),
      userId,
    ).maybeSingle(),
    'poroteos.exists',
  );
  return existe;
}

export async function deleteVotos(id) {
  unwrap(
    await supabaseAdmin.from('poroteo_votos').delete().eq('poroteo_id', id),
    'poroteos.votos.delete',
  );
}

/**
 * @param {Array<Partial<import('../entities/PoroteoVoto.js').default>>} rows
 * @returns {Promise<void>}
 */
export async function upsertVotos(rows) {
  unwrap(
    await supabaseAdmin
      .from('poroteo_votos')
      .upsert(rows, { onConflict: 'poroteo_id,diputado_id' }),
    'poroteos.votos.upsert',
  );
}

export async function touchPoroteo(id, origen, userId) {
  unwrap(
    await propietario(supabaseAdmin.from('poroteos').update({ origen }).eq('id', id), userId),
    'poroteos.touch',
  );
}

/** @returns {Promise<Array<Pick<import('../entities/Poroteo.js').default, 'id'>>>} */
export async function deletePoroteo(id, userId) {
  const { data } = unwrap(
    await propietario(supabaseAdmin.from('poroteos').delete().eq('id', id), userId).select('id'),
    'poroteos.delete',
  );
  return data;
}
