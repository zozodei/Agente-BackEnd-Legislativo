/** Error controlado de la aplicación. El middleware de errores lo transforma en respuesta. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, details) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }

  static notFound(message = 'Recurso no encontrado') {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static unauthorized(message = 'Tenés que iniciar sesión', code = 'UNAUTHORIZED') {
    return new AppError(401, code, message);
  }

  static forbidden(message = 'No tenés permiso para hacer esto', code = 'FORBIDDEN') {
    return new AppError(403, code, message);
  }

  static conflict(message, details) {
    return new AppError(409, 'CONFLICT', message, details);
  }

  static upstream(message = 'Error consultando la base de datos', details) {
    return new AppError(502, 'UPSTREAM_ERROR', message, details);
  }

  static unavailable(message, details) {
    return new AppError(503, 'SERVICE_UNAVAILABLE', message, details);
  }
}
