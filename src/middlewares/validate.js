import { AppError } from '../utils/AppError.js';

/**
 * Valida params / query / body con esquemas de zod.
 * El resultado parseado (con defaults y coerciones) queda en `req.valid`.
 * (En Express 5 `req.query` es de solo lectura, por eso no se pisa.)
 *
 * @example router.get('/:id', validate({ params: idParam }), controller.get)
 */
export function validate(schemas) {
  return (req, _res, next) => {
    req.valid = req.valid ?? {};
    for (const part of ['params', 'query', 'body']) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        return next(
          AppError.badRequest(
            'Datos de entrada inválidos',
            result.error.issues.map((issue) => ({
              campo: [part, ...issue.path].join('.'),
              mensaje: issue.message,
            })),
          ),
        );
      }
      req.valid[part] = result.data;
    }
    return next();
  };
}
