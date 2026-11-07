import { authToken } from './authToken.js';
import { getUsuario } from '../services/auth.service.js';
import { AppError } from '../utils/AppError.js';

/** Consulta Auth en cada solicitud; no usa getSession ni confía en metadata/JWT local. */
export async function autenticar(req, res, next) {
  // Mantiene la extracción Zod compartida y los datos validados en req.valid.
  let error;
  authToken(req, res, (err) => {
    error = err;
  });
  if (error) return next(error);
  req.usuario = await getUsuario(req.valid.auth.accessToken);
  // No autoriza ni elige actor: evita ejecutar una petición de la pestaña A
  // con cookies de B durante el cambio de cuenta. El actor sigue siendo getUser.
  if (req.valid.auth.expectedUserId && req.valid.auth.expectedUserId !== req.usuario.id) {
    return next(new AppError(401, 'SESSION_EXPIRED', 'La cuenta de la sesión cambió'));
  }
  return next();
}

/** Se usa después de autenticar; deniega también si se monta incorrectamente solo. */
export function soloSuperadmin(req, _res, next) {
  if (!req.usuario) return next(new AppError(401, 'UNAUTHORIZED', 'Se requiere iniciar sesión'));
  if (req.usuario.rol !== 'superadmin') {
    return next(new AppError(403, 'FORBIDDEN', 'No tenés acceso al backoffice'));
  }
  return next();
}
