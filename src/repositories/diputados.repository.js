import { supabase } from '../config/supabase.js';
import { isMissingRelation, sanitizeSearch, unwrap } from '../utils/supabaseHelpers.js';
import { toRange } from '../utils/pagination.js';
import { logger } from '../config/logger.js';

const LIST_COLUMNS = [
  'id',
  'apellido',
  'nombre',
  'nombre_completo',
  'distrito',
  'bloque',
  'inicia_mandato',
  'finaliza_mandato',
  'persona_id',
  'foto_url',
  'coalicion_historica',
  'presentismo',
  'total_votaciones',
  'ausencias',
  'abstenciones',
  'alin_pj',
  'alin_pro',
  'alin_lla',
  'alin_ucr',
].join(',');

export async function fetchDiputados() {
  const { data } = unwrap(
    await supabase
      .from('v_diputados_actuales')
      .select(LIST_COLUMNS)
      .order('apellido')
      .range(0, 999),
    'diputados.all',
  );
  return data;
}

export async function fetchAlineacionBloque(personaId) {
  const { data, error } = await supabase.rpc('fn_alineacion_bloque', {
    p_persona_id: personaId,
    p_solo_general: false,
  });
  if (error) {
    if (isMissingRelation(error)) {
      logger.warn('fn_alineacion_bloque no existe: aplicar la migración de supabase/migrations');
      return null;
    }
    unwrap({ error }, 'diputados.alineacionBloque');
  }
  return data?.[0] ?? null;
}

export async function fetchDiputado(id) {
  const { data: row } = unwrap(
    await supabase.from('v_diputados_actuales').select('*').eq('id', id).maybeSingle(),
    'diputados.get',
  );
  return row;
}

export async function fetchMandatos(personaId) {
  const { data } = unwrap(
    await supabase
      .from('cv_mandatos')
      .select('camara,anio_desde,anio_hasta,bloque,provincia,coalicion,alianza')
      .eq('persona_id', personaId)
      .order('anio_desde', { ascending: true }),
    'diputados.mandatos',
  );
  return data;
}

export async function fetchVotosDiputado(
  personaId,
  { q, voto, anio, soloGeneral, page, pageSize },
) {
  const { from, to } = toRange(page, pageSize);
  let query = supabase
    .from('v_votos')
    .select(
      'votacion_id,fecha,anio,titulo,nombre_ley,etiqueta,resultado,ley_id,voto,bloque,coalicion,provincia,postura_pj,postura_pro,postura_lla,postura_ucr,url',
      { count: 'exact' },
    )
    .eq('persona_id', personaId)
    .eq('camara', 'diputados');

  if (voto) query = query.eq('voto', voto);
  if (anio) query = query.eq('anio', anio);
  if (soloGeneral) query = query.eq('etiqueta', 'En General');
  if (q) {
    const term = sanitizeSearch(q);
    if (term) query = query.or(`titulo.ilike.%${term}%,nombre_ley.ilike.%${term}%`);
  }

  const { data, count } = unwrap(
    await query.order('fecha', { ascending: false }).range(from, to),
    'diputados.votos',
  );

  return { data, count };
}
