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
