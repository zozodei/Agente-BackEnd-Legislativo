import { supabase } from '../config/supabase.js';
import { fetchAll, sanitizeSearch, unwrap } from '../utils/supabaseHelpers.js';
import { toRange } from '../utils/pagination.js';

const LIST_COLUMNS =
  'id,titulo,titulo_sitio,nombre_ley,ley_id,etiqueta,es_general,fecha,anio,resultado,afirmativos,negativos,abstenciones,ausentes,url';

export async function fetchVotaciones({
  q,
  desde,
  hasta,
  anio,
  resultado,
  soloGeneral,
  page,
  pageSize,
}) {
  const { from, to } = toRange(page, pageSize);
  let query = supabase
    .from('cv_votaciones')
    .select(LIST_COLUMNS, { count: 'exact' })
    .eq('camara', 'diputados');

  if (q) {
    const term = sanitizeSearch(q);
    if (term) {
      query = query.or(
        `titulo.ilike.%${term}%,titulo_sitio.ilike.%${term}%,nombre_ley.ilike.%${term}%`,
      );
    }
  }
  if (desde) query = query.gte('fecha', `${desde}T00:00:00`);
  if (hasta) query = query.lte('fecha', `${hasta}T23:59:59`);
  if (anio) query = query.eq('anio', anio);
  if (resultado) query = query.eq('resultado', resultado);
  if (soloGeneral) query = query.eq('es_general', true);

  const { data, count } = unwrap(
    await query
      .order('fecha', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
    'votaciones.list',
  );
  return { data, count };
}

export async function fetchUltimasVotaciones(limit, soloGeneral) {
  let query = supabase.from('cv_votaciones').select(LIST_COLUMNS).eq('camara', 'diputados');
  if (soloGeneral) query = query.eq('es_general', true);
  const { data } = unwrap(
    await query.order('fecha', { ascending: false }).limit(limit),
    'votaciones.latest',
  );
  return data;
}

export async function fetchVotacion(id) {
  const { data: row } = unwrap(
    await supabase
      .from('cv_votaciones')
      .select('*')
      .eq('id', id)
      .eq('camara', 'diputados')
      .maybeSingle(),
    'votaciones.get',
  );
  return row;
}

export async function fetchVotosVotacion(id) {
  const votos = await fetchAll(
    (from, to) =>
      supabase
        .from('v_votos')
        .select('persona_id,legislador,diputado_actual_id,bloque,coalicion,provincia,voto')
        .eq('votacion_id', id)
        .order('legislador')
        .range(from, to),
    'votaciones.votos',
  );

  return votos;
}

export async function fetchFotos(personaIds) {
  if (!personaIds.length) return [];
  return unwrap(
    await supabase.from('v_personas').select('id,foto_url').in('id', personaIds),
    'votaciones.fotos',
  ).data;
}

export async function fetchLey(leyId) {
  if (!leyId) return null;
  return unwrap(
    await supabase
      .from('cv_leyes')
      .select('id,nombre,nombre_comun,anio,keywords,cantidad_votaciones')
      .eq('id', leyId)
      .maybeSingle(),
    'votaciones.ley',
  ).data;
}

export async function fetchVotacionesDeLey(leyId) {
  if (!leyId) return [];
  return unwrap(
    await supabase
      .from('cv_votaciones')
      .select('id,etiqueta,es_general,resultado,fecha')
      .eq('ley_id', leyId)
      .order('fecha')
      .limit(200),
    'votaciones.hermanas',
  ).data;
}

export async function countVotaciones(filters = {}, contexto = 'stats.total') {
  let query = supabase
    .from('cv_votaciones')
    .select('id', { count: 'exact', head: true })
    .eq('camara', 'diputados');
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  return unwrap(await query, contexto).count ?? 0;
}
