import { createAuthClient, supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';

/*
 * Inicio de sesión con Google (Supabase Auth).
 * Flujo recomendado para este repo (SPA React + Vite):
 *   1. El front pide GET /api/auth/google y recibe { url }.
 *   2. Redirige el navegador a esa URL (Supabase → Google → consentimiento).
 *   3. Google deriva a FRONTEND_URL/auth/callback con el token en el hash (flujo implicit).
 *   4. El front extrae el access_token del hash y lo usa como
 *      "Authorization: Bearer <token>" contra GET /api/auth/me y el resto de la API.
 * El front nunca toca Supabase directamente: la URL la genera el backend.
 */

function nombreDeUser(user) {
  return (
    user?.user_metadata?.nombre ??
    user?.user_metadata?.name ??
    user?.user_metadata?.full_name ??
    null
  );
}

function avatarDeUser(user) {
  return (
    user?.user_metadata?.avatar_url ??
    user?.user_metadata?.picture ??
    user?.user_metadata?.avatar ??
    null
  );
}

function toUsuarioDTO(user) {
  return {
    id: user.id,
    email: user.email,
    nombre: nombreDeUser(user),
    avatarUrl: avatarDeUser(user),
    createdAt: user.created_at ?? null,
  };
}

function toSesionDTO(session) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    // Segundos desde epoch (Unix). El front renueva un poco antes con /auth/refresh.
    expiresAt: session.expires_at,
    tokenType: 'bearer',
  };
}

/** Valida que el retorno del OAuth sea un origen permitido (evita redirecciones abiertas). */
function esRedirectPermitido(url) {
  let origen;
  try {
    origen = new URL(url).origin;
  } catch {
    return false;
  }
  const permitidos = new Set([...env.CORS_ORIGINS, new URL(env.FRONTEND_URL).origin]);
  return permitidos.has(origen);
}

/** Traduce los errores de Supabase Auth a AppError con mensajes para mostrar. */
function toAppError(error, contexto) {
  const code = error?.code;
  switch (code) {
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
    case 'session_not_found':
    case 'session_expired':
    case 'bad_jwt':
    case 'user_not_found':
      return AppError.unauthorized('La sesión venció. Iniciá sesión de nuevo.', 'SESSION_EXPIRED');
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return new AppError(
        429,
        'RATE_LIMITED',
        'Demasiados intentos. Esperá unos minutos y probá de nuevo.',
      );
    case 'validation_failed':
    case 'invalid_id_token':
    case 'bad_code_verifier':
      return AppError.badRequest(error.message || 'No se pudo validar la sesión de Google');
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

function redirectPorDefecto() {
  return `${env.FRONTEND_URL.replace(/\/$/, '')}/auth/callback`;
}

/**
 * Genera la URL de Google OAuth para que el front redirija al navegador.
 * El proveedor Google debe estar habilitado en Supabase (ver README).
 */
export async function generarUrlGoogle({ redirectTo } = {}) {
  const redirect = redirectTo ?? redirectPorDefecto();
  if (redirectTo && !esRedirectPermitido(redirectTo)) {
    throw AppError.badRequest('El redirectTo no está permitido', { redirectTo });
  }

  const { data, error } = await createAuthClient().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirect,
      skipBrowserRedirect: true,
      queryParams: {
        access_type: 'offline',
        prompt: 'select_account',
      },
    },
  });
  if (error) throw toAppError(error, 'auth.google.url');
  return { url: data.url };
}

/**
 * Alternativa sin redirección (One Tap / botones pre-armados de Google):
 * el front obtiene el id_token de Google y lo envía acá para crear la sesión.
 */
export async function autenticarConIdTokenGoogle({ idToken, nonce }) {
  const { data, error } = await createAuthClient().auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
    ...(nonce ? { nonce } : {}),
  });
  if (error) throw toAppError(error, 'auth.google.id_token');
  if (!data.session) throw AppError.unauthorized('No se pudo crear la sesión de Google');
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
export async function cerrarSesion(accessToken) {
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
    nombre: nombreDeUser({ user_metadata: claims.user_metadata ?? {} }),
    avatarUrl: avatarDeUser({ user_metadata: claims.user_metadata ?? {} }),
  };
}
