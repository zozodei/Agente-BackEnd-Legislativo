import multer from 'multer';
import { AppError } from '../utils/AppError.js';
import { isProduction } from '../config/env.js';
import { logger } from '../config/logger.js';

/** 404 para rutas que no existen. */
export function notFound(req, _res, next) {
  next(AppError.notFound(`No existe la ruta ${req.method} ${req.originalUrl}`));
}

/**
 * Middleware centralizado de errores.
 * Formato de respuesta: { error: { code, message, details? } }
 * En producción nunca se devuelve el stack ni detalles de errores inesperados.
 */
export function errorHandler(err, req, res, _next) {
  let error = err;

  if (err instanceof multer.MulterError) {
    error = AppError.badRequest(
      err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera el tamaño máximo (10 MB)' : err.message,
    );
  } else if (err?.type === 'entity.parse.failed') {
    error = AppError.badRequest('El cuerpo de la request no es JSON válido');
  } else if (err?.type === 'entity.too.large') {
    error = new AppError(413, 'PAYLOAD_TOO_LARGE', 'El cuerpo de la request es demasiado grande');
  }

  if (!(error instanceof AppError)) {
    (req.log ?? logger).error({ err }, 'Error no controlado');
    error = new AppError(500, 'INTERNAL_ERROR', 'Ocurrió un error inesperado');
    if (!isProduction) error.details = { message: err?.message, stack: err?.stack };
  } else if (error.status >= 500) {
    (req.log ?? logger).warn({ err: error }, error.message);
  }

  res.status(error.status).json({
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined && { details: error.details }),
    },
  });
}
