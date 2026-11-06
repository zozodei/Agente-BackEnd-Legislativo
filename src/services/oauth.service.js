import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';
import { toSesionDTO, toUsuarioDTO } from './auth.service.js';

/*
 * Inicio de sesión con Google (OAuth de Supabase Auth, flujo PKCE).
 *
 * El front nunca habla con Supabase, así que el flujo pasa por acá:
 *  1. POST /auth/google → armamos la URL de autorización de Supabase con un
 *     code_challenge (SHA-256 de un verifier aleatorio) y devolvemos URL + verifier.
 *     El front guarda el verifier en sessionStorage y redirige el navegador.
 *  2. Google → Supabase → vuelve al front en FRONTEND_URL/auth/callback?code=...
 *  3. POST /auth/google/callback { code, codeVerifier } → canjeamos el código por
 *     la sesión (grant_type=pkce). Sin el verifier correcto el código no sirve,
 *     así que un código robado o inyectado no alcanza para entrar.
 *
 * Se usa la API REST de Supabase Auth (GoTrue) en lugar de supabase-js porque
 * supabase-js guarda el verifier en su propio storage interno, pensado para
 * correr en el navegador.
 */

const AUTH_URL = `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;

/** URL a la que Supabase devuelve al usuario. Tiene que estar en "Redirect URLs" de Supabase. */
export const callbackUrl = () => `${env.FRONTEND_URL}/auth/callback`;

const base64url = (buf) => buf.toString('base64url');

export function crearPkce() {
  const codeVerifier = base64url(randomBytes(48)); // 64 caracteres (RFC 7636: 43–128)
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

/*
 * ¿Está activo Google en Supabase? (GET /auth/v1/settings, público).
 * Se consulta antes de mandar al usuario a Supabase: si no está activo, Supabase
 * muestra un JSON de error crudo. Se cachea 1 minuto para no pegarle en cada click.
 */
let googleActivoCache = { valor: null, hasta: 0 };

export function limpiarCacheOAuth() {
  googleActivoCache = { valor: null, hasta: 0 };
}

async function googleActivo() {
  if (googleActivoCache.hasta > Date.now()) return googleActivoCache.valor;
  try {
    const res = await fetch(`${AUTH_URL}/settings`, {
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY },
    });
    if (!res.ok) return true; // no sabemos: dejamos que Supabase decida
    const settings = await res.json();
    const valor = Boolean(settings?.external?.google);
    googleActivoCache = { valor, hasta: Date.now() + 60_000 };
    return valor;
  } catch {
    return true; // sin red con Supabase: el error se verá al volver
  }
}

export async function iniciarGoogle() {
  if (!(await googleActivo())) {
    throw new AppError(
      503,
      'GOOGLE_DISABLED',
      'El inicio con Google todavía no está habilitado. Entrá con email y contraseña.',
    );
  }
  const { codeVerifier, codeChallenge } = crearPkce();
  const params = new URLSearchParams({
    provider: 'google',
    redirect_to: callbackUrl(),
    code_challenge: codeChallenge,
    code_challenge_method: 's256',
    // Que Google deje elegir cuenta aunque ya haya una sesión abierta en el navegador.
    prompt: 'select_account',
  });
  return { url: `${AUTH_URL}/authorize?${params}`, codeVerifier };
}

// Códigos de Supabase Auth que significan "el código no sirve" (vencido, usado o ajeno).
const CODIGO_INVALIDO = new Set([
  'flow_state_not_found',
  'flow_state_expired',
  'bad_code_verifier',
  'bad_oauth_state',
  'bad_oauth_callback',
  'validation_failed',
]);

export async function completarGoogle({ code, codeVerifier }) {
  let res;
  try {
    res = await fetch(`${AUTH_URL}/token?grant_type=pkce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ auth_code: code, code_verifier: codeVerifier }),
    });
  } catch (err) {
    logger.error({ err, contexto: 'auth.google' }, 'Error de red con Supabase Auth');
    throw AppError.upstream('Error comunicándose con el servicio de autenticación', {
      contexto: 'auth.google',
    });
  }

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const code = payload?.error_code ?? payload?.code ?? payload?.error;
    if (
      res.status < 500 &&
      (CODIGO_INVALIDO.has(code) || res.status === 400 || res.status === 404)
    ) {
      throw new AppError(
        400,
        'OAUTH_FAILED',
        'No se pudo completar el inicio con Google. El link venció o ya se usó: probá de nuevo.',
      );
    }
    logger.error({ status: res.status, code, contexto: 'auth.google' }, 'Error de Supabase Auth');
    throw AppError.upstream('Error comunicándose con el servicio de autenticación', {
      contexto: 'auth.google',
    });
  }

  if (!payload?.access_token || !payload.user) {
    throw AppError.upstream('Respuesta inesperada del servicio de autenticación', {
      contexto: 'auth.google',
    });
  }
  return { usuario: toUsuarioDTO(payload.user), sesion: toSesionDTO(payload) };
}
