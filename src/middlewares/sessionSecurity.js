import { env, isProduction } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const prefix = isProduction ? '__Secure-' : '';
export const ACCESS_COOKIE = `${prefix}poroteo_access`;
export const REFRESH_COOKIE = `${prefix}poroteo_refresh`;

export function readCookie(req, name) {
  const values = (req.headers.cookie ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  try {
    return decodeURIComponent(values[0].slice(name.length + 1));
  } catch {
    return null;
  }
}

const cookieOptions = (path) => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: env.SESSION_SAME_SITE,
  path,
});

export function clearSessionCookies(res) {
  res.clearCookie(ACCESS_COOKIE, cookieOptions('/api'));
  res.clearCookie(REFRESH_COOKIE, cookieOptions('/api/auth'));
}

export function respondAuth(req, res, data, status = 200) {
  if (!req.cookieSession) return res.status(status).json({ data });
  const { sesion, ...rest } = data;
  if (!sesion) {
    clearSessionCookies(res);
    return res.status(status).json({ data: { ...rest, sesion: null } });
  }
  res.cookie(ACCESS_COOKIE, sesion.accessToken, {
    ...cookieOptions('/api'),
    maxAge: Math.max(0, sesion.expiresAt * 1000 - Date.now()),
  });
  res.cookie(REFRESH_COOKIE, sesion.refreshToken, {
    ...cookieOptions('/api/auth'),
    maxAge: env.SESSION_DAYS * 86400_000,
  });
  const { expiresIn, expiresAt, tokenType } = sesion;
  return res
    .status(status)
    .json({ data: { ...rest, sesion: { expiresIn, expiresAt, tokenType } } });
}

/** CSRF: encabezado no simple + Origin exacto, incluso en login y multipart.
 * La presencia de cookies exige este control aunque se envíe además un Bearer.
 */
export function sessionSecurity(req, _res, next) {
  req.cookieSession = req.get('X-Session-Mode') === 'cookie';
  const hasCookie = readCookie(req, ACCESS_COOKIE) || readCookie(req, REFRESH_COOKIE);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (req.cookieSession || hasCookie)) {
    if (!req.cookieSession || !env.CORS_ORIGINS.includes(req.get('Origin'))) {
      return next(new AppError(403, 'CSRF_FORBIDDEN', 'Origen de la solicitud no válido'));
    }
  }
  return next();
}
