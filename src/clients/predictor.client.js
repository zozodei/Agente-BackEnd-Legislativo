import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';

/**
 * Cliente HTTP del servicio Python de predicción (ml/). Solo transporta: la validación
 * de la respuesta y las reglas viven en services/prediccion.service.js.
 */
export async function solicitarPrediccion(entrada) {
  let res;
  try {
    res = await fetch(`${env.PREDICTOR_URL}/predecir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(entrada),
      signal: AbortSignal.timeout(env.PREDICTOR_TIMEOUT_MS),
      redirect: 'error',
    });
  } catch (err) {
    logger.warn({ err: err?.name }, 'predictor: sin respuesta');
    throw AppError.upstream('El servicio de predicción no respondió. Probá de nuevo más tarde.');
  }
  if (!res.ok) {
    logger.warn({ status: res.status }, 'predictor: respuesta con error');
    throw AppError.upstream('El servicio de predicción devolvió un error.');
  }
  try {
    return await res.json();
  } catch {
    throw AppError.upstream('El servicio de predicción devolvió una respuesta inválida.');
  }
}
