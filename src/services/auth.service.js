import { createAuthClient, supabaseAdmin } from '../config/supabase.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';

/*
 * Cuentas de usuario con Supabase Auth (email + contraseña).
 * El front nunca habla con Supabase: usa /api/auth/* y manda el accessToken
 * como "Authorization: Bearer <token>" en cada request protegida.
 */

/** Nombre visible: el del registro, o el que trae Google (full_name / name). */
export function nombreDe(metadata) {
  const nombre = metadata?.nombre ?? metadata?.full_name ?? metadata?.name ?? null;
  return typeof nombre === 'string' && nombre.trim() ? nombre.trim().slice(0, 120) : null;
}

export function toUsuarioDTO(user) {
  return {
    id: user.id,
    email: user.email,
    nombre: nombreDe(user.user_metadata),
    createdAt: user.created_at ?? null,
  };
}

export function toSesionDTO(session) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    // Segundos desde epoch (Unix). El front renueva un poco antes con /auth/refresh.
    expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
    tokenType: 'bearer',
  };
}

/** Traduce los errores de Supabase Auth a AppError con mensajes para mostrar. */
function toAppError(error, contexto) {
  const code = error?.code;
  switch (code) {
    case 'invalid_credentials':
      return AppError.unauthorized('Email o contraseña incorrectos', 'INVALID_CREDENTIALS');
    case 'email_not_confirmed':
      return AppError.forbidden(
        'Tenés que confirmar tu email antes de iniciar sesión. Revisá tu casilla.',
        'EMAIL_NOT_CONFIRMED',
      );
    case 'user_already_exists':
    case 'email_exists':
      return AppError.conflict('Ya existe una cuenta con ese email');
    case 'weak_password':
      return AppError.badRequest('La contraseña es demasiado débil', {
        motivos: error.reasons ?? [],
      });
    case 'email_address_invalid':
      return AppError.badRequest('El email no es válido');
    case 'signup_disabled':
    case 'email_provider_disabled':
      return AppError.forbidden('El registro de cuentas está deshabilitado');
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return new AppError(
        429,
        'RATE_LIMITED',
        'Demasiados intentos. Esperá unos minutos y probá de nuevo.',
      );
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
    case 'session_not_found':
    case 'session_expired':
    case 'bad_jwt':
    case 'user_not_found':
      return AppError.unauthorized('La sesión venció. Iniciá sesión de nuevo.', 'SESSION_EXPIRED');
    default:
      logger.error({ err: error, contexto }, 'Error de Supabase Auth');
      if (error?.status && error.status < 500) {
        return AppError.badRequest(error.message || 'No se pudo completar la operación');
      }
      return AppError.upstream('Error comunicándose con el servicio de autenticación', {
        contexto,
      });
  }
}

/**
 * Crea una cuenta.
 * Si en Supabase está activa la confirmación por email, no devuelve sesión
 * (`requiereConfirmacion: true`) y el usuario tiene que confirmar antes de loguearse.
 */
export async function registrar({ email, password, nombre }) {
  const { data, error } = await createAuthClient().auth.signUp({
    email,
    password,
    options: { data: { nombre } },
  });
  if (error) throw toAppError(error, 'auth.registro');

  return {
    usuario: toUsuarioDTO(data.user),
    sesion: data.session ? toSesionDTO(data.session) : null,
    requiereConfirmacion: !data.session,
  };
}

export async function login({ email, password }) {
  const { data, error } = await createAuthClient().auth.signInWithPassword({ email, password });
  if (error) throw toAppError(error, 'auth.login');
  return { usuario: toUsuarioDTO(data.user), sesion: toSesionDTO(data.session) };
}

/** Cambia un refreshToken por una sesión nueva (el refreshToken viejo deja de servir). */
export async function refrescar({ refreshToken }) {
  const { data, error } = await createAuthClient().auth.refreshSession({
    refresh_token: refreshToken,
  });
  if (error) throw toAppError(error, 'auth.refresh');
  if (!data.session) throw AppError.unauthorized('La sesión venció. Iniciá sesión de nuevo.');
  return { usuario: toUsuarioDTO(data.user), sesion: toSesionDTO(data.session) };
}

/** Invalida la sesión actual (el refreshToken deja de servir). Nunca falla hacia el cliente. */
export async function logout(accessToken) {
  const { error } = await supabaseAdmin.auth.admin.signOut(accessToken, 'local');
  if (error) logger.warn({ err: error }, 'No se pudo cerrar la sesión en Supabase');
}

/**
 * Verifica un accessToken y devuelve el usuario.
 * getClaims valida firma y vencimiento localmente (claves JWKS en caché),
 * así no se consulta a Supabase en cada request.
 */
export async function verificarToken(accessToken) {
  const { data, error } = await supabaseAdmin.auth.getClaims(accessToken);
  if (error) {
    // Errores de red o de Supabase caído → 502, no "sesión inválida".
    if (error.name === 'AuthRetryableFetchError' || error.status >= 500) {
      throw toAppError(error, 'auth.verificar');
    }
    throw AppError.unauthorized('La sesión es inválida o venció', 'SESSION_EXPIRED');
  }

  const claims = data?.claims;
  if (!claims?.sub || claims.role !== 'authenticated') {
    throw AppError.unauthorized('La sesión es inválida o venció', 'SESSION_EXPIRED');
  }
  return {
    id: claims.sub,
    email: claims.email ?? null,
    nombre: nombreDe(claims.user_metadata),
  };
}
