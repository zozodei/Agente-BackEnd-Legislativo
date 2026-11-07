import { bearerHeader, expectedUserHeader } from '../validators/auth.validator.js';
import { AppError } from '../utils/AppError.js';
import { ACCESS_COOKIE, readCookie } from './sessionSecurity.js';

/** Extrae un Bearer validado; el service verificará su autenticidad con Supabase Auth. */
export function authToken(req, _res, next) {
  const token = req.cookieSession ? readCookie(req, ACCESS_COOKIE) : null;
  const parsed = bearerHeader.safeParse(token ? `Bearer ${token}` : req.headers.authorization);
  const expected = expectedUserHeader.safeParse(
    req.cookieSession ? req.get('X-Expected-User') : undefined,
  );
  if (!parsed.success || !expected.success) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Se requiere iniciar sesión'));
  }
  req.valid = { ...req.valid, auth: { accessToken: parsed.data, expectedUserId: expected.data } };
  return next();
}
