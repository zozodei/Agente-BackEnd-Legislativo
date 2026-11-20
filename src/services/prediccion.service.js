// Poroteo con IA: genera la predicción de los 257, la guarda y gestiona los ajustes manuales.
import { MotorPrediccion } from '../prediccion/motor.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';
import * as poroteosRepository from '../repositories/poroteos.repository.js';
import * as prediccionRepository from '../repositories/prediccion.repository.js';
import { getAllDiputados } from './diputados.service.js';
import { getPoroteo } from './poroteos.service.js';
import { completarExplicaciones } from './explicaciones.service.js';
import { calcularResultado } from './resultado.js';

let motor = null;

/** El motor se carga una vez por proceso (~1 s): historial, LSA y pesos del modelo. */
export function getMotor() {
  if (!motor) {
    try {
      motor = MotorPrediccion.cargar();
      logger.info({ version: motor.version }, 'Motor de predicción cargado');
    } catch (error) {
      logger.error({ err: error }, 'No se pudo cargar el motor de predicción');
      throw AppError.unavailable(
        'El modelo de predicción no está disponible (faltan los artefactos de data/modelo).',
      );
    }
  }
  return motor;
}

/** Solo para tests. */
export function setMotor(m) {
  motor = m;
}

function diputadosParaMotor(diputados) {
  return diputados.map((d) => ({
    id: d.id,
    personaId: d.personaId,
    bloque: d.bloque,
    nombreCompleto: d.nombreCompleto,
  }));
}

/** Información pública del modelo (versión, entrenamiento, métricas de calibración). */
export function getModelo() {
  const m = getMotor();
  return {
    version: m.version,
    tipo: m.modelo.tipo,
    entrenamiento: m.modelo.entrenamiento ?? null,
    datos: m.historia.meta,
  };
}

/** Rasgos detectados y votaciones parecidas para un texto, antes de crear el poroteo. */
export function analizarProyecto({ titulo, resumen, texto }) {
  const m = getMotor();
  const rasgos = m.analizar({ titulo, resumen, texto });
  return { ...rasgos, similares: m.similares({ titulo, resumen, texto }, { k: 8 }) };
}

function toPrediccionDTO(row) {
  return {
    diputadoId: row.diputado_id,
    voto: row.voto_predicho,
    probabilidades: {
      AFIRMATIVO: Number(row.prob_afirmativo),
      NEGATIVO: Number(row.prob_negativo),
      ABSTENCION: Number(row.prob_abstencion),
      AUSENTE: Number(row.prob_ausente),
    },
    confianza: Number(row.confianza),
    nivelConfianza: row.nivel_confianza,
    explicacion: row.explicacion,
    explicacionFuente: row.explicacion_fuente,
    explicacionEstado: row.explicacion_estado,
    factores: row.factores,
    versionModelo: row.version_modelo,
  };
}

function toAjusteDTO(row) {
  return {
    id: row.id,
    diputadoId: row.diputado_id,
    voto: row.voto_manual,
    motivo: row.motivo,
    userId: row.user_id,
    createdAt: row.created_at,
  };
}

async function exigirMiembro(id, userId) {
  if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Se requiere iniciar sesión');
  const row = await poroteosRepository.fetchPoroteo(id, userId);
  if (!row) throw AppError.notFound(`No existe el poroteo ${id}`);
  return row;
}

/** Predicción, factores y ajustes de un poroteo. */
export async function getPrediccion(id, userId) {
  await exigirMiembro(id, userId);
  const [meta, filas, ajustes] = await Promise.all([
    prediccionRepository.fetchMetaPrediccion(id),
    prediccionRepository.fetchPredicciones(id),
    prediccionRepository.fetchAjustes(id),
  ]);
  // Ajuste vigente por diputado = el último registrado.
  const vigentes = new Map();
  for (const a of ajustes) vigentes.set(a.diputado_id, a);
  return {
    versionModelo: meta?.version_modelo ?? null,
    generadaAt: meta?.prediccion_at ?? null,
    supuestos: meta?.supuestos ?? {},
    resumen: meta?.metadata?.prediccion ?? null,
    predicciones: filas.map(toPrediccionDTO),
    ajustesVigentes: [...vigentes.values()].filter((a) => a.voto_manual !== null).map(toAjusteDTO),
    historialAjustes: ajustes.map(toAjusteDTO),
  };
}

const redondear = (x) => Math.round(x * 10000) / 10000;

/**
 * Ejecuta el motor para el texto del poroteo y guarda la predicción.
 * Los ajustes manuales previos se conservan y siguen mandando sobre la IA.
 */
export async function generarPrediccion(id, { version, supuestos = {} }, userId) {
  const row = await exigirMiembro(id, userId);
  const m = getMotor();
  const diputados = diputadosParaMotor(await getAllDiputados());
  const t0 = Date.now();
  const r = m.predecir(
    { titulo: row.titulo, resumen: row.descripcion, texto: row.texto_proyecto, ...supuestos },
    diputados,
  );
  const msPrediccion = Date.now() - t0;
  const explicaciones = await completarExplicaciones(r.predicciones);

  let proyectoId = null;
  try {
    const rep = m.representacion({
      titulo: row.titulo,
      resumen: row.descripcion,
      texto: row.texto_proyecto,
    });
    proyectoId = await prediccionRepository.insertProyecto({
      camara: row.camara ?? 'diputados',
      fuente: 'usuario',
      titulo: row.titulo.slice(0, 1000),
      resumen: row.descripcion,
      texto: row.texto_proyecto,
      tema: r.proyecto.tema,
      tipo: r.proyecto.tipo,
      dictamen: r.proyecto.dictamen,
      origen_senado: r.proyecto.origenSenado,
      fecha: r.fecha,
      embedding: `[${rep.vector.map((x) => redondear(x)).join(',')}]`,
      version_embedding: `lsa-${m.lsa.dims}`,
      creado_por: userId,
    });
  } catch (error) {
    // Guardar el proyecto es auditoría; no debe impedir el poroteo.
    logger.warn({ err: error }, 'No se pudo guardar el proyecto con su embedding');
  }

  const filas = r.predicciones.map((p) => ({
    diputado_id: p.diputadoId,
    voto_predicho: p.voto,
    prob_afirmativo: p.probabilidades.AFIRMATIVO,
    prob_negativo: p.probabilidades.NEGATIVO,
    prob_abstencion: p.probabilidades.ABSTENCION,
    prob_ausente: p.probabilidades.AUSENTE,
    confianza: p.confianza,
    nivel_confianza: p.nivelConfianza,
    explicacion: p.explicacion,
    explicacion_fuente: p.explicacionFuente ?? 'plantilla',
    explicacion_estado: p.explicacionEstado ?? 'sin_llm',
    factores: p.factores,
    version_modelo: r.versionModelo,
  }));
  const meta = {
    version_modelo: r.versionModelo,
    supuestos: r.supuestos,
    proyecto_id: proyectoId,
    resumen: {
      fecha: r.fecha,
      proyecto: r.proyecto,
      gobierno: r.gobierno,
      esperados: r.resumen.esperados,
      porVoto: r.resumen.porVoto,
      nivelConfianza: r.resumen.nivelConfianza,
      similares: r.similares.slice(0, 6),
      similaresRecientes: r.similaresRecientes.slice(0, 6),
      explicaciones,
      msPrediccion,
    },
  };
  const actualizado = await prediccionRepository.guardarPrediccion(
    id,
    userId,
    version,
    filas,
    meta,
  );
  return respuestaConVersion(id, userId, actualizado);
}

async function respuestaConVersion(id, userId, actualizado) {
  const [poroteo, prediccion] = await Promise.all([
    getPoroteo(id, userId),
    getPrediccion(id, userId),
  ]);
  if (String(poroteo.version) !== String(actualizado.version)) {
    throw new AppError(
      409,
      'VERSION_CONFLICT',
      'Tu operación se guardó, pero otra persona volvió a modificar el poroteo. Recargalo para ver la última versión.',
    );
  }
  return { poroteo, prediccion };
}

/** Registra ajustes manuales (voto null = volver a la predicción de la IA). */
export async function ajustarVotos(id, { version, ajustes }, userId) {
  await exigirMiembro(id, userId);
  const actualizado = await prediccionRepository.ajustarVotos(
    id,
    userId,
    version,
    ajustes.map((a) => ({ diputado_id: a.diputadoId, voto: a.voto, motivo: a.motivo ?? null })),
  );
  return respuestaConVersion(id, userId, actualizado);
}

/** Totales del poroteo con cualquier tipo de mayoría (p. ej. evaluar dos tercios). */
export async function getResultado(id, tipoMayoria, userId) {
  const poroteo = await getPoroteo(id, userId);
  return {
    tipoMayoria,
    version: poroteo.version,
    resumen: calcularResultado(
      poroteo.votos.map((v) => v.voto),
      tipoMayoria,
    ),
  };
}
