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

  static upstream(message = 'Error consultando la base de datos', details) {
    return new AppError(502, 'UPSTREAM_ERROR', message, details);
  }

  static unavailable(message, details) {
    return new AppError(503, 'SERVICE_UNAVAILABLE', message, details);
  }
}
