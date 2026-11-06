import { bearerHeader } from '../validators/auth.validator.js';
import { AppError } from '../utils/AppError.js';

/** Extrae un Bearer validado; el service verificará su autenticidad con Supabase Auth. */
export function authToken(req, _res, next) {
  const parsed = bearerHeader.safeParse(req.headers.authorization);
  if (!parsed.success) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Se requiere iniciar sesión'));
  }
  req.valid = { ...req.valid, auth: { accessToken: parsed.data } };
  return next();
}
