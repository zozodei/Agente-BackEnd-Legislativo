import { countVotaciones } from '../repositories/votaciones.repository.js';
import { fetchMetadata } from '../repositories/metadata.repository.js';
import { DIPUTADOS_TOTAL, FUENTE_DATOS, QUORUM_DIPUTADOS } from '../config/constants.js';
import { listBloques } from './catalogos.service.js';
import { getAllDiputados } from './diputados.service.js';
import { latestVotaciones } from './votaciones.service.js';

/** Números generales para el panel de inicio. */
export async function getResumen() {
  const anioActual = new Date().getFullYear();

  const [diputados, bloques, ultimas, totalRes, aprobadasRes, rechazadasRes, anioRes, metaRes] =
    await Promise.all([
      getAllDiputados(),
      listBloques(),
      latestVotaciones(6, true),
      countVotaciones({}, 'stats.total'),
      countVotaciones({ resultado: 'AFIRMATIVO' }, 'stats.aprobadas'),
      countVotaciones({ resultado: 'NEGATIVO' }, 'stats.rechazadas'),
      countVotaciones({ anio: anioActual }, 'stats.anio'),
      fetchMetadata(),
    ]);

  const meta = Object.fromEntries(metaRes.map((m) => [m.clave, m.valor]));
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
      total: totalRes,
      aprobadas: aprobadasRes,
      rechazadas: rechazadasRes,
      anioActual: { anio: anioActual, total: anioRes },
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
