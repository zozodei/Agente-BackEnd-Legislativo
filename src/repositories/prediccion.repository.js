// Tablas del poroteo con IA (migración 20261120120000_poroteo_ia.sql). Solo supabaseAdmin.
import { supabaseAdmin } from '../config/supabase.js';
import { fetchAll, unwrap } from '../utils/supabaseHelpers.js';
import { AppError } from '../utils/AppError.js';
import { lanzarErrorRpc } from './poroteos.repository.js';

async function rpc(nombre, params, contexto) {
  if (!params.p_actor_id) throw new AppError(401, 'UNAUTHORIZED', 'Se requiere iniciar sesión');
  const result = await supabaseAdmin.rpc(nombre, params);
  lanzarErrorRpc(result.error);
  return unwrap(result, contexto).data;
}

/** Reemplaza la predicción de un poroteo y recalcula los votos finales (transacción). */
export function guardarPrediccion(poroteoId, actorId, version, predicciones, meta) {
  return rpc(
    'poroteo_guardar_prediccion',
    {
      p_poroteo_id: poroteoId,
      p_actor_id: actorId,
      p_version: version,
      p_predicciones: predicciones,
      p_meta: meta,
    },
    'prediccion.guardar',
  );
}

/** Agrega ajustes manuales al historial y recalcula los votos finales (transacción). */
export function ajustarVotos(poroteoId, actorId, version, ajustes) {
  return rpc(
    'poroteo_ajustar_votos',
    { p_poroteo_id: poroteoId, p_actor_id: actorId, p_version: version, p_ajustes: ajustes },
    'prediccion.ajustar',
  );
}

export function fetchPredicciones(poroteoId) {
  return fetchAll(
    (from, to) =>
      supabaseAdmin
        .from('predicciones')
        .select(
          'diputado_id,voto_predicho,prob_afirmativo,prob_negativo,prob_abstencion,prob_ausente,confianza,nivel_confianza,explicacion,explicacion_fuente,explicacion_estado,factores,version_modelo,created_at',
        )
        .eq('poroteo_id', poroteoId)
        .order('diputado_id')
        .range(from, to),
    'prediccion.list',
  );
}

export function fetchAjustes(poroteoId) {
  return fetchAll(
    (from, to) =>
      supabaseAdmin
        .from('ajustes_manuales')
        .select('id,diputado_id,voto_manual,motivo,user_id,created_at')
        .eq('poroteo_id', poroteoId)
        .order('id')
        .range(from, to),
    'prediccion.ajustes',
  );
}

/** Columnas de la migración IA de un poroteo (la membresía ya se verificó antes). */
export async function fetchMetaPrediccion(poroteoId) {
  const { data } = unwrap(
    await supabaseAdmin
      .from('poroteos')
      .select('supuestos,version_modelo,prediccion_at,proyecto_id,metadata,version')
      .eq('id', poroteoId)
      .maybeSingle(),
    'prediccion.meta',
  );
  return data;
}

/** Guarda el proyecto cargado por el usuario con su embedding (pgvector). */
export async function insertProyecto(row) {
  const { data } = unwrap(
    await supabaseAdmin.from('proyectos').insert(row).select('id').single(),
    'proyectos.insert',
  );
  return data.id;
}
