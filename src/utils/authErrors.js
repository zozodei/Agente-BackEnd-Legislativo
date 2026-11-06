import { AppError } from './AppError.js';
import { logger } from '../config/logger.js';

const SESSION_CODES = new Set([
  'bad_jwt',
  'session_not_found',
  'session_expired',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'user_not_found',
  'user_banned',
]);

/** Traducción única de errores Auth. No registrar respuestas que puedan contener tokens. */
export function unwrapAuth({ data, error }, contexto) {
  if (!error) return data;
  if (
    error.status === 429 ||
    ['over_request_rate_limit', 'over_email_send_rate_limit'].includes(error.code)
  ) {
    throw new AppError(429, 'RATE_LIMITED', 'Demasiados intentos. Esperá unos minutos.');
  }
  if (error.code === 'email_not_confirmed') {
    throw new AppError(403, 'EMAIL_NOT_CONFIRMED', 'Confirmá tu email antes de iniciar sesión');
  }
  if (error.code === 'invalid_credentials') {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email o contraseña incorrectos');
  }
  if (['user_already_exists', 'email_exists'].includes(error.code)) {
    throw new AppError(409, 'CONFLICT', 'Ya existe una cuenta con ese email');
  }
  if (['signup_disabled', 'email_provider_disabled'].includes(error.code)) {
    throw new AppError(403, 'FORBIDDEN', 'El registro por email no está habilitado');
  }
  if (error.code === 'email_address_not_authorized') {
    throw new AppError(
      403,
      'FORBIDDEN',
      'El proveedor de correo no permite ese destinatario. Revisá la configuración SMTP de Supabase Auth.',
    );
  }
  if (
    SESSION_CODES.has(error.code) ||
    (['auth.me', 'auth.refresh', 'auth.logout'].includes(contexto) &&
      [401, 403].includes(error.status))
  ) {
    throw new AppError(401, 'SESSION_EXPIRED', 'La sesión venció o no es válida');
  }
  if (error.code === 'weak_password') {
    throw AppError.badRequest('La contraseña no cumple los requisitos', [
      {
        campo: 'body.password',
        mensaje: 'Usá una contraseña más segura según la configuración del proyecto',
      },
    ]);
  }
  if (['email_address_invalid', 'validation_failed'].includes(error.code)) {
    throw AppError.badRequest('Revisá los datos de registro');
  }
  // Errores de red/TLS, proveedor de correo o fallos internos no son credenciales inválidas.
  const code =
    typeof error.code === 'string' && /^[a-z_]+$/.test(error.code) ? error.code : undefined;
  logger.warn({ contexto, status: error.status, code }, 'Fallo del proveedor de autenticación');
  throw AppError.upstream('No se pudo conectar con el servicio de autenticación', { contexto });
}
