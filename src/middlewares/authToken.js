import {
  bearerHeader,
  expectedUserHeader,
  cookieLogoutTokens,
} from '../validators/auth.validator.js';
import { AppError } from '../utils/AppError.js';
import { ACCESS_COOKIE, REFRESH_COOKIE, readCookie } from './sessionSecurity.js';

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

/** Logout cookie selecciona la sesión del refresh; nunca toma el Bearer o el body. */
export function logoutTokens(req, res, next) {
  if (!req.cookieSession) return authToken(req, res, next);
  const refreshToken = readCookie(req, REFRESH_COOKIE);
  const accessToken = readCookie(req, ACCESS_COOKIE);
  const parsed = cookieLogoutTokens.safeParse(
    refreshToken ? { refreshToken } : accessToken ? { accessToken } : {},
  );
  if (!parsed.success) {
    return next(new AppError(401, 'SESSION_EXPIRED', 'La sesión venció o no es válida'));
  }
  req.valid = { ...req.valid, auth: parsed.data };
  return next();
}
