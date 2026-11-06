import { verificarToken } from '../services/auth.service.js';
import { AppError } from '../utils/AppError.js';

/**
 * Exige "Authorization: Bearer <accessToken>".
 * Deja el usuario en `req.usuario` ({ id, email, nombre }) y el token en `req.accessToken`.
 */
export async function requireAuth(req, _res, next) {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw AppError.unauthorized('Tenés que iniciar sesión');
  }
  req.usuario = await verificarToken(token);
  req.accessToken = token;
  next();
}
