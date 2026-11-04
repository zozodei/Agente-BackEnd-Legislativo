import { supabase } from '../config/supabase.js';
import { RESULTADOS_VALIDOS } from '../config/constants.js';
import { AppError } from '../utils/AppError.js';
import { paginated, toRange } from '../utils/pagination.js';
import { fetchAll, sanitizeSearch, unwrap } from '../utils/supabaseHelpers.js';

const LIST_COLUMNS =
  'id,titulo,titulo_sitio,nombre_ley,ley_id,etiqueta,es_general,fecha,anio,resultado,afirmativos,negativos,abstenciones,ausentes,url';

/**
 * Algunos registros traen el resultado como número (error del dato original).
 * Se expone `resultado` limpio (o null) y `resultadoOriginal` tal cual vino.
 */
function cleanResultado(value) {
  return RESULTADOS_VALIDOS.includes(value) ? value : null;
}

export function porcentajes({ afirmativos, negativos, abstenciones, ausentes }) {
  const total = afirmativos + negativos + abstenciones + ausentes;
  const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  return {
    afirmativos: pct(afirmativos),
    negativos: pct(negativos),
    abstenciones: pct(abstenciones),
    ausentes: pct(ausentes),
  };
}

export function toVotacionDTO(row) {
  const conteo = {
    afirmativos: row.afirmativos ?? 0,
    negativos: row.negativos ?? 0,
    abstenciones: row.abstenciones ?? 0,
    ausentes: row.ausentes ?? 0,
  };
  return {
    id: row.id,
    titulo: row.titulo_sitio || row.titulo,
    tituloActa: row.titulo,
    nombreLey: row.nombre_ley,
    leyId: row.ley_id,
    etiqueta: row.etiqueta,
    esGeneral: Boolean(row.es_general),
    fecha: row.fecha,
    anio: row.anio,
    resultado: cleanResultado(row.resultado),
    resultadoOriginal: row.resultado,
    conteo,
    porcentajes: porcentajes(conteo),
    url: row.url,
  };
}

export async function listVotaciones({
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
  return paginated(data.map(toVotacionDTO), { page, pageSize, total: count ?? 0 });
}

/** Últimas votaciones (para el panel de inicio). */
export async function latestVotaciones(limit = 6, soloGeneral = true) {
  let query = supabase.from('cv_votaciones').select(LIST_COLUMNS).eq('camara', 'diputados');
  if (soloGeneral) query = query.eq('es_general', true);
  const { data } = unwrap(
    await query.order('fecha', { ascending: false }).limit(limit),
    'votaciones.latest',
  );
  return data.map(toVotacionDTO);
}

/** Detalle completo de una votación, con el voto de cada diputado. */
export async function getVotacion(id) {
  const { data: row } = unwrap(
    await supabase
      .from('cv_votaciones')
      .select('*')
      .eq('id', id)
      .eq('camara', 'diputados')
      .maybeSingle(),
    'votaciones.get',
  );
  if (!row) throw AppError.notFound(`No existe la votación ${id}`);

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

  const personaIds = votos.map((v) => v.persona_id);
  const [fotosRes, leyRes, hermanasRes] = await Promise.all([
    personaIds.length
      ? supabase.from('v_personas').select('id,foto_url').in('id', personaIds)
      : Promise.resolve({ data: [] }),
    row.ley_id
      ? supabase
          .from('cv_leyes')
          .select('id,nombre,nombre_comun,anio,keywords,cantidad_votaciones')
          .eq('id', row.ley_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    row.ley_id
      ? supabase
          .from('cv_votaciones')
          .select('id,etiqueta,es_general,resultado,fecha')
          .eq('ley_id', row.ley_id)
          .order('fecha')
          .limit(200)
      : Promise.resolve({ data: [] }),
  ]);
  const fotos = new Map(unwrap(fotosRes, 'votaciones.fotos').data.map((p) => [p.id, p.foto_url]));
  const { data: ley } = unwrap(leyRes, 'votaciones.ley');
  const { data: hermanas } = unwrap(hermanasRes, 'votaciones.hermanas');

  const porBloque = new Map();
  for (const v of votos) {
    const key = v.bloque ?? 'Sin bloque';
    if (!porBloque.has(key)) {
      porBloque.set(key, {
        bloque: key,
        AFIRMATIVO: 0,
        NEGATIVO: 0,
        ABSTENCION: 0,
        AUSENTE: 0,
        PRESIDENTE: 0,
        total: 0,
      });
    }
    const agg = porBloque.get(key);
    agg[v.voto] += 1;
    agg.total += 1;
  }

  return {
    ...toVotacionDTO(row),
    keywords: row.keywords ?? [],
    posturas: {
      pj: row.postura_pj,
      pro: row.postura_pro,
      lla: row.postura_lla,
      ucr: row.postura_ucr,
    },
    ley: ley
      ? {
          id: ley.id,
          nombre: ley.nombre_comun || ley.nombre,
          anio: ley.anio,
          keywords: ley.keywords ?? [],
          cantidadVotaciones: ley.cantidad_votaciones,
        }
      : null,
    votacionesDeLaLey: hermanas.map((h) => ({
      id: h.id,
      etiqueta: h.etiqueta,
      esGeneral: Boolean(h.es_general),
      resultado: cleanResultado(h.resultado),
      fecha: h.fecha,
    })),
    porBloque: [...porBloque.values()].sort((a, b) => b.total - a.total),
    votos: votos.map((v) => ({
      personaId: v.persona_id,
      diputadoId: v.diputado_actual_id,
      nombre: v.legislador,
      bloque: v.bloque,
      coalicion: v.coalicion,
      provincia: v.provincia,
      voto: v.voto,
      fotoUrl: fotos.get(v.persona_id) ?? null,
    })),
  };
}
