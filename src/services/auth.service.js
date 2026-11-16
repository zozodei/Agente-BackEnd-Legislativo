import * as authRepository from '../repositories/auth.repository.js';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { resolverRol } from './roles.service.js';

function toUsuarioDTO(user, incluirFecha = true) {
  if (!user?.id || !user.email) throw AppError.upstream('Respuesta de autenticación incompleta');
  return {
    id: user.id,
    email: user.email,
    rol: resolverRol(user),
    // Es un dato de presentación editable, nunca un rol ni un permiso.
    nombre: typeof user.user_metadata?.nombre === 'string' ? user.user_metadata.nombre : null,
    ...(incluirFecha && user.created_at ? { createdAt: user.created_at } : {}),
  };
}

function toSesionDTO(session) {
  if (
    !session?.access_token ||
    !session.refresh_token ||
    !Number.isFinite(session.expires_at) ||
    !Number.isFinite(session.expires_in) ||
    session.token_type !== 'bearer'
  ) {
    throw AppError.upstream('Respuesta de sesión incompleta');
  }
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    expiresAt: session.expires_at,
    tokenType: 'bearer',
  };
}

function toAuthDTO(data) {
  if (!data) throw AppError.upstream('Respuesta de autenticación incompleta');
  return { usuario: toUsuarioDTO(data.user), sesion: toSesionDTO(data.session) };
}

export async function registrar(input) {
  const data = await authRepository.registrar(input, `${env.CORS_ORIGINS[0]}/login`);
  if (!data) throw AppError.upstream('Respuesta de autenticación incompleta');
  return {
    // Sin sesión (incluidas respuestas ofuscadas de Auth) no se anuncian privilegios.
    usuario: { ...toUsuarioDTO(data.user), ...(!data.session && { rol: 'usuario' }) },
    sesion: data.session ? toSesionDTO(data.session) : null,
    requiereConfirmacion: !data.session,
  };
}

export async function login(input) {
  return toAuthDTO(await authRepository.login(input));
}

export async function refresh(refreshToken) {
  return toAuthDTO(await authRepository.refresh(refreshToken));
}

export async function getUsuario(accessToken) {
  const data = await authRepository.getUsuario(accessToken);
  if (!data?.user) throw new AppError(401, 'SESSION_EXPIRED', 'La sesión venció o no es válida');
  return toUsuarioDTO(data.user, false);
}

export async function logout(accessToken, refreshToken) {
  if (refreshToken) {
    // El proveedor valida y rota la credencial de ESA sesión. No decodificar el
    // access vencido ni usarlo como alternativa si el refresh es rechazado.
    const data = await authRepository.refresh(refreshToken);
    accessToken = toSesionDTO(data?.session).accessToken;
  }
  // Sin cookies, logout es idempotente. Bearer mantiene su validación obligatoria.
  if (accessToken) await authRepository.logout(accessToken);
}

/* ── Google (OAuth de Supabase Auth con PKCE) ─────────────────────────── */

/**
 * Solo se vuelve a /auth/callback de un origen permitido (CORS_ORIGINS):
 * así el endpoint no sirve como redirección abierta.
 */
function validarRedirectGoogle(redirectTo) {
  let url;
  try {
    url = new URL(redirectTo);
  } catch {
    url = null;
  }
  if (
    !url ||
    !env.CORS_ORIGINS.includes(url.origin) ||
    url.pathname !== '/auth/callback' ||
    url.search ||
    url.hash
  ) {
    throw AppError.badRequest('redirectTo no permitido');
  }
  return url.href;
}

/** Devuelve la URL de Google y el verifier PKCE, que el controller guarda en cookie HttpOnly. */
export async function iniciarGoogle(redirectTo) {
  const destino = validarRedirectGoogle(redirectTo);
  if (!(await authRepository.googleHabilitado())) {
    throw new AppError(
      503,
      'GOOGLE_DISABLED',
      'El ingreso con Google todavía no está habilitado. Ingresá con email y contraseña.',
    );
  }
  const codeVerifier = randomBytes(48).toString('base64url'); // 64 caracteres (RFC 7636)
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return {
    url: authRepository.urlAutorizarGoogle({ redirectTo: destino, codeChallenge }),
    codeVerifier,
  };
}

/** Canjea el código que trae Google por la sesión. Sin el verifier de esta cuenta no sirve. */
export async function completarGoogle({ code, codeVerifier }) {
  return toAuthDTO(await authRepository.canjearCodigoGoogle({ code, codeVerifier }));
}
