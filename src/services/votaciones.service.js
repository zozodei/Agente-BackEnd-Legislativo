import * as votacionesRepository from '../repositories/votaciones.repository.js';
import { RESULTADOS_VALIDOS } from '../config/constants.js';
import { AppError } from '../utils/AppError.js';
import { paginated } from '../utils/pagination.js';

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
  const { data, count } = await votacionesRepository.fetchVotaciones({
    q,
    desde,
    hasta,
    anio,
    resultado,
    soloGeneral,
    page,
    pageSize,
  });
  return paginated(data.map(toVotacionDTO), { page, pageSize, total: count ?? 0 });
}

/** Últimas votaciones (para el panel de inicio). */
export async function latestVotaciones(limit = 6, soloGeneral = true) {
  const data = await votacionesRepository.fetchUltimasVotaciones(limit, soloGeneral);
  return data.map(toVotacionDTO);
}

/** Detalle completo de una votación, con el voto de cada diputado. */
export async function getVotacion(id) {
  const row = await votacionesRepository.fetchVotacion(id);
  if (!row) throw AppError.notFound(`No existe la votación ${id}`);

  const votos = await votacionesRepository.fetchVotosVotacion(id);

  const [personas, ley, hermanas] = await Promise.all([
    votacionesRepository.fetchFotos(votos.map((v) => v.persona_id)),
    votacionesRepository.fetchLey(row.ley_id),
    votacionesRepository.fetchVotacionesDeLey(row.ley_id),
  ]);
  const fotos = new Map(personas.map((p) => [p.id, p.foto_url]));

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
