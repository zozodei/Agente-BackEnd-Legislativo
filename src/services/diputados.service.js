import { supabase } from '../config/supabase.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { createCache } from '../utils/cache.js';
import { paginated, paginateArray, toRange } from '../utils/pagination.js';
import { isMissingRelation, sanitizeSearch, unwrap } from '../utils/supabaseHelpers.js';
import { normalize } from '../utils/text.js';
import { logger } from '../config/logger.js';

const cache = createCache(env.CACHE_DIPUTADOS_MINUTOS * 60_000);

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

/** Fila de v_diputados_actuales → DTO en camelCase que consume el frontend. */
export function toDiputadoDTO(row) {
  return {
    id: row.id,
    apellido: row.apellido,
    nombre: row.nombre,
    nombreCompleto: row.nombre_completo,
    distrito: row.distrito,
    bloque: row.bloque,
    iniciaMandato: row.inicia_mandato,
    finalizaMandato: row.finaliza_mandato,
    personaId: row.persona_id,
    fotoUrl: row.foto_url,
    coalicionHistorica: row.coalicion_historica,
    presentismo: row.presentismo === null ? null : Number(row.presentismo),
    totalVotaciones: row.total_votaciones,
    ausencias: row.ausencias,
    abstenciones: row.abstenciones,
    alineamiento: {
      pj: numOrNull(row.alin_pj),
      pro: numOrNull(row.alin_pro),
      lla: numOrNull(row.alin_lla),
      ucr: numOrNull(row.alin_ucr),
    },
  };
}

function numOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

/** Los 257 diputados actuales, cacheados en memoria (cambian muy poco). */
export function getAllDiputados() {
  return cache.getOrSet('diputados', async () => {
    const { data } = unwrap(
      await supabase
        .from('v_diputados_actuales')
        .select(LIST_COLUMNS)
        .order('apellido')
        .range(0, 999),
      'diputados.all',
    );
    return data.map(toDiputadoDTO);
  });
}

export function clearDiputadosCache() {
  cache.clear();
}

/** Mapa id → diputado, útil para validar y enriquecer poroteos. */
export async function getDiputadosById() {
  const all = await getAllDiputados();
  return new Map(all.map((d) => [d.id, d]));
}

const SORTERS = {
  apellido: (a, b) => a.apellido.localeCompare(b.apellido, 'es'),
  bloque: (a, b) =>
    a.bloque.localeCompare(b.bloque, 'es') || a.apellido.localeCompare(b.apellido, 'es'),
  distrito: (a, b) =>
    a.distrito.localeCompare(b.distrito, 'es') || a.apellido.localeCompare(b.apellido, 'es'),
  presentismo: (a, b) => (b.presentismo ?? -1) - (a.presentismo ?? -1),
};

export async function listDiputados({ q, bloque, distrito, orden, page, pageSize }) {
  const all = await getAllDiputados();
  const needle = q ? normalize(q) : null;
  const bloqueN = bloque ? normalize(bloque) : null;
  const distritoN = distrito ? normalize(distrito) : null;

  const filtered = all
    .filter((d) => !needle || normalize(`${d.nombre} ${d.apellido}`).includes(needle))
    .filter((d) => !bloqueN || normalize(d.bloque) === bloqueN)
    .filter((d) => !distritoN || normalize(d.distrito) === distritoN)
    .sort(SORTERS[orden]);

  return paginateArray(filtered, page, pageSize);
}

/** Suma los stats_anuales en un total por tipo de voto. */
export function summarizeStats(statsAnuales) {
  const totals = { total: 0, AFIRMATIVO: 0, NEGATIVO: 0, ABSTENCION: 0, AUSENTE: 0, PRESIDENTE: 0 };
  for (const year of Object.values(statsAnuales ?? {})) {
    for (const key of Object.keys(totals)) totals[key] += Number(year?.[key] ?? 0);
  }
  const pct = (n) => (totals.total ? Math.round((n / totals.total) * 1000) / 10 : null);
  return {
    total: totals.total,
    conteo: {
      afirmativo: totals.AFIRMATIVO,
      negativo: totals.NEGATIVO,
      abstencion: totals.ABSTENCION,
      ausente: totals.AUSENTE,
      presidente: totals.PRESIDENTE,
    },
    porcentaje: {
      afirmativo: pct(totals.AFIRMATIVO),
      negativo: pct(totals.NEGATIVO),
      abstencion: pct(totals.ABSTENCION),
      ausente: pct(totals.AUSENTE),
    },
  };
}

/** Alineación con la mayoría de su bloque. Si la función SQL todavía no existe, devuelve null. */
async function getAlineacionBloque(personaId) {
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
  const row = data?.[0];
  if (!row || !row.votaciones) return null;
  return {
    votaciones: row.votaciones,
    coincidencias: row.coincidencias,
    porcentaje: numOrNull(row.porcentaje),
  };
}

/** Perfil completo de un diputado actual. */
export async function getDiputado(id) {
  const { data: row } = unwrap(
    await supabase.from('v_diputados_actuales').select('*').eq('id', id).maybeSingle(),
    'diputados.get',
  );
  if (!row) throw AppError.notFound(`No existe el diputado ${id}`);

  const [mandatosRes, alineacionBloque] = await Promise.all([
    row.persona_id
      ? supabase
          .from('cv_mandatos')
          .select('camara,anio_desde,anio_hasta,bloque,provincia,coalicion,alianza')
          .eq('persona_id', row.persona_id)
          .order('anio_desde', { ascending: true })
      : Promise.resolve({ data: [] }),
    row.persona_id ? getAlineacionBloque(row.persona_id) : Promise.resolve(null),
  ]);
  const { data: mandatos } = unwrap(mandatosRes, 'diputados.mandatos');

  return {
    ...toDiputadoDTO(row),
    mandatos: mandatos.map((m) => ({
      camara: m.camara,
      desde: m.anio_desde,
      hasta: m.anio_hasta,
      bloque: m.bloque,
      provincia: m.provincia,
      coalicion: m.coalicion,
      alianza: m.alianza,
    })),
    estadisticas: {
      ...summarizeStats(row.stats_anuales),
      alineacionBloque,
      porAnio: row.stats_anuales ?? {},
    },
    alineamientoAnual: row.alineamiento_anual ?? {},
    alineamientoEra: row.alineamiento_era ?? {},
  };
}

/** Historial de votos de un diputado actual, paginado. */
export async function getVotosDiputado(id, { q, voto, anio, soloGeneral, page, pageSize }) {
  const diputados = await getDiputadosById();
  const diputado = diputados.get(id);
  if (!diputado) throw AppError.notFound(`No existe el diputado ${id}`);
  if (!diputado.personaId) return paginated([], { page, pageSize, total: 0 });

  const { from, to } = toRange(page, pageSize);
  let query = supabase
    .from('v_votos')
    .select(
      'votacion_id,fecha,anio,titulo,nombre_ley,etiqueta,resultado,ley_id,voto,bloque,coalicion,provincia,postura_pj,postura_pro,postura_lla,postura_ucr,url',
      { count: 'exact' },
    )
    .eq('persona_id', diputado.personaId)
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

  return paginated(
    data.map((v) => ({
      votacionId: v.votacion_id,
      fecha: v.fecha,
      anio: v.anio,
      titulo: v.titulo,
      nombreLey: v.nombre_ley,
      etiqueta: v.etiqueta,
      resultado: v.resultado,
      leyId: v.ley_id,
      voto: v.voto,
      bloque: v.bloque,
      coalicion: v.coalicion,
      provincia: v.provincia,
      posturas: { pj: v.postura_pj, pro: v.postura_pro, lla: v.postura_lla, ucr: v.postura_ucr },
      url: v.url,
    })),
    { page, pageSize, total: count ?? 0 },
  );
}
