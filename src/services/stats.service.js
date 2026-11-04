import { supabase } from '../config/supabase.js';
import { DIPUTADOS_TOTAL, FUENTE_DATOS, QUORUM_DIPUTADOS } from '../config/constants.js';
import { unwrap } from '../utils/supabaseHelpers.js';
import { listBloques } from './catalogos.service.js';
import { getAllDiputados } from './diputados.service.js';
import { latestVotaciones } from './votaciones.service.js';

function countVotaciones(filters = {}) {
  let query = supabase
    .from('cv_votaciones')
    .select('id', { count: 'exact', head: true })
    .eq('camara', 'diputados');
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  return query;
}

/** Números generales para el panel de inicio. */
export async function getResumen() {
  const anioActual = new Date().getFullYear();

  const [diputados, bloques, ultimas, totalRes, aprobadasRes, rechazadasRes, anioRes, metaRes] =
    await Promise.all([
      getAllDiputados(),
      listBloques(),
      latestVotaciones(6, true),
      countVotaciones(),
      countVotaciones({ resultado: 'AFIRMATIVO' }),
      countVotaciones({ resultado: 'NEGATIVO' }),
      countVotaciones({ anio: anioActual }),
      supabase.from('cv_meta').select('clave,valor'),
    ]);

  const meta = Object.fromEntries(
    unwrap(metaRes, 'stats.meta').data.map((m) => [m.clave, m.valor]),
  );
  const conPresentismo = diputados.filter((d) => d.presentismo !== null);
  const presentismoPromedio = conPresentismo.length
    ? Math.round(
        (conPresentismo.reduce((s, d) => s + d.presentismo, 0) / conPresentismo.length) * 10,
      ) / 10
    : null;

  const vencimientos = {};
  for (const d of diputados) {
    const anio = d.finalizaMandato?.slice(0, 4);
    if (anio) vencimientos[anio] = (vencimientos[anio] ?? 0) + 1;
  }

  const primeraMinoria = bloques[0] ?? null;

  return {
    camara: {
      bancas: DIPUTADOS_TOTAL,
      diputados: diputados.length,
      quorum: QUORUM_DIPUTADOS,
      bloques: bloques.length,
      primeraMinoria,
      presentismoPromedio,
      mandatosQueVencen: vencimientos,
    },
    composicion: bloques,
    votaciones: {
      total: unwrap(totalRes, 'stats.total').count ?? 0,
      aprobadas: unwrap(aprobadasRes, 'stats.aprobadas').count ?? 0,
      rechazadas: unwrap(rechazadasRes, 'stats.rechazadas').count ?? 0,
      anioActual: { anio: anioActual, total: unwrap(anioRes, 'stats.anio').count ?? 0 },
      ultimas,
    },
    fuente: {
      ...FUENTE_DATOS,
      actualizado: meta.stats_sitio?.last_updated ?? null,
      cargado: meta.cargado ?? null,
      commit: meta.fuente?.commit ?? null,
    },
  };
}
