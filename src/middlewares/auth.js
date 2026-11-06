import { verificarToken } from '../services/auth.service.js';
import { AppError } from '../utils/AppError.js';

function tokenDeReq(req) {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/**
 * Exige "Authorization: Bearer <accessToken>".
 * Deja el usuario en `req.usuario` ({ id, email, nombre, avatarUrl }) y el token en `req.accessToken`.
 */
export async function requireAuth(req, _res, next) {
  const token = tokenDeReq(req);
  if (!token) {
    throw AppError.unauthorized('Tenés que iniciar sesión');
  }
  req.usuario = await verificarToken(token);
  req.accessToken = token;
  next();
}

/**
 * Login opcional: si llega Bearer válido lo adjunta en `req.usuario`,
 * si no llega, sigue como anónimo. Si llega un token inválido, responde 401.
 */
export async function optionalAuth(req, _res, next) {
  const token = tokenDeReq(req);
  if (!token) {
    req.usuario = null;
    req.accessToken = null;
    next();
    return;
  }
  req.usuario = await verificarToken(token);
  req.accessToken = token;
  next();
}
