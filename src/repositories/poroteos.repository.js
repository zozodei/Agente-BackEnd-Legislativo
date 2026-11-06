import { supabaseAdmin } from '../config/supabase.js';
import { fetchAll, sanitizeSearch, unwrap } from '../utils/supabaseHelpers.js';
import { toRange } from '../utils/pagination.js';

const POROTEO_COLUMNS =
  'id,titulo,descripcion,archivo_nombre,camara,tipo_mayoria,estado,origen,autor,metadata,created_at,updated_at';

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
  return unwrap(
    await supabaseAdmin.from('poroteos').insert(row).select(POROTEO_COLUMNS).single(),
    'poroteos.create',
  ).data;
}

/** @returns {Promise<{data: Array<Omit<import('../entities/Poroteo.js').default, 'texto_proyecto'>>, count: number | null | undefined}>} */
export async function fetchPoroteos({ q, page, pageSize }) {
  const { from, to } = toRange(page, pageSize);
  let query = supabaseAdmin.from('poroteos').select(POROTEO_COLUMNS, { count: 'exact' });
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
export async function fetchPoroteo(id) {
  const { data: row } = unwrap(
    await supabaseAdmin
      .from('poroteos')
      .select(`${POROTEO_COLUMNS},texto_proyecto`)
      .eq('id', id)
      .maybeSingle(),
    'poroteos.get',
  );
  return row;
}

/**
 * @param {string} id
 * @param {Partial<import('../entities/Poroteo.js').default>} patch
 * @returns {Promise<Array<Pick<import('../entities/Poroteo.js').default, 'id'>>>}
 */
export async function updatePoroteo(id, patch) {
  const { data } = unwrap(
    await supabaseAdmin.from('poroteos').update(patch).eq('id', id).select('id'),
    'poroteos.update',
  );
  return data;
}

/** @returns {Promise<Pick<import('../entities/Poroteo.js').default, 'id'> | null>} */
export async function fetchPoroteoId(id) {
  const { data: existe } = unwrap(
    await supabaseAdmin.from('poroteos').select('id').eq('id', id).maybeSingle(),
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

export async function touchPoroteo(id, origen) {
  unwrap(await supabaseAdmin.from('poroteos').update({ origen }).eq('id', id), 'poroteos.touch');
}

/** @returns {Promise<Array<Pick<import('../entities/Poroteo.js').default, 'id'>>>} */
export async function deletePoroteo(id) {
  const { data } = unwrap(
    await supabaseAdmin.from('poroteos').delete().eq('id', id).select('id'),
    'poroteos.delete',
  );
  return data;
}
