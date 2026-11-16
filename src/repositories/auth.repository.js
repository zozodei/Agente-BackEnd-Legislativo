import { createAuthClient } from '../config/supabaseAuth.js';
import { unwrapAuth } from '../utils/authErrors.js';
import { env } from '../config/env.js';
import { createHash } from 'node:crypto';
import { AppError } from '../utils/AppError.js';

const refreshing = new Map();

async function consultarAuth(contexto, ejecutar) {
  let result;
  try {
    result = await ejecutar(createAuthClient().auth);
  } catch (error) {
    // Algunos fallos de transporte rechazan la promesa en vez de devolver { error }.
    return unwrapAuth({ error }, contexto);
  }
  return unwrapAuth(result, contexto);
}

export function registrar({ email, password, nombre }, emailRedirectTo) {
  return consultarAuth('auth.registro', (auth) =>
    auth.signUp({
      email,
      password,
      options: { data: { nombre }, emailRedirectTo },
    }),
  );
}

export function login({ email, password }) {
  return consultarAuth('auth.login', (auth) => auth.signInWithPassword({ email, password }));
}

export function refresh(refreshToken) {
  // Deduplicación solamente en vuelo; no persistir refresh tokens ni respuestas.
  const key = createHash('sha256').update(refreshToken).digest('hex');
  if (refreshing.has(key)) return refreshing.get(key);
  const operation = consultarAuth('auth.refresh', (auth) =>
    auth.refreshSession({ refresh_token: refreshToken }),
  ).finally(() => refreshing.delete(key));
  refreshing.set(key, operation);
  return operation;
}

export function getUsuario(accessToken) {
  return consultarAuth('auth.me', async (auth) => {
    const verified = unwrapAuth(await auth.getClaims(accessToken), 'auth.me');
    const claims = verified?.claims;
    const issuer = env.SUPABASE_JWT_ISSUER ?? `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
    const audience = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
    if (
      !claims?.sub ||
      claims.iss !== issuer ||
      !audience.includes(env.SUPABASE_JWT_AUDIENCE) ||
      !Number.isFinite(claims.exp) ||
      claims.exp * 1000 <= Date.now()
    ) {
      return { error: { status: 401, code: 'bad_jwt' } };
    }
    // getClaims verifica el JWT; getUser comprueba además el estado actual de la cuenta.
    const result = await auth.getUser(accessToken);
    if (!result.error && result.data?.user?.id !== claims.sub) {
      return { error: { status: 401, code: 'bad_jwt' } };
    }
    return result;
  });
}

export function logout(accessToken) {
  // Es el método que signOut del SDK usa internamente. Recibe el JWT explícito,
  // sin setSession ni refresh implícito. El cliente usa la clave PÚBLICA, nunca admin.
  return consultarAuth('auth.logout', (auth) => auth.admin.signOut(accessToken, 'local'));
}

const AUTH_URL = () => `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;

/** ¿Está activo Google en Supabase Auth? Endpoint público de configuración. */
export async function googleHabilitado() {
  try {
    const res = await fetch(`${AUTH_URL()}/settings`, {
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY },
    });
    if (!res.ok) return true; // sin certeza: que Supabase decida al autorizar
    const settings = await res.json();
    return Boolean(settings?.external?.google);
  } catch {
    return true;
  }
}

/** URL de autorización de Supabase para Google con PKCE (S256). */
export function urlAutorizarGoogle({ redirectTo, codeChallenge }) {
  const params = new URLSearchParams({
    provider: 'google',
    redirect_to: redirectTo,
    code_challenge: codeChallenge,
    code_challenge_method: 's256',
    prompt: 'select_account',
  });
  return `${AUTH_URL()}/authorize?${params}`;
}

// Códigos de Supabase Auth que significan "ese código no sirve" (vencido, usado o ajeno).
const CODIGO_INVALIDO = new Set([
  'flow_state_not_found',
  'flow_state_expired',
  'bad_code_verifier',
  'bad_oauth_state',
  'bad_oauth_callback',
  'validation_failed',
]);

/**
 * Canjea el código de Google por una sesión (grant_type=pkce). Se usa la API REST
 * porque supabase-js guarda el verifier en su propio storage de navegador.
 * Devuelve { user, session } como el resto de los métodos de este módulo.
 */
export async function canjearCodigoGoogle({ code, codeVerifier }) {
  let res;
  try {
    res = await fetch(`${AUTH_URL()}/token?grant_type=pkce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ auth_code: code, code_verifier: codeVerifier }),
    });
  } catch (error) {
    return unwrapAuth({ error }, 'auth.google');
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const codigo = payload?.error_code ?? payload?.code ?? payload?.error;
    if (res.status < 500 && (CODIGO_INVALIDO.has(codigo) || [400, 404].includes(res.status))) {
      throw new AppError(
        400,
        'OAUTH_FAILED',
        'No se pudo completar el ingreso con Google. El link venció o ya se usó: probá de nuevo.',
      );
    }
    return unwrapAuth({ error: { status: res.status, code: codigo } }, 'auth.google');
  }
  if (!payload?.user) return null;
  const expiresAt = Number.isFinite(payload.expires_at)
    ? payload.expires_at
    : Math.floor(Date.now() / 1000) + payload.expires_in;
  return { user: payload.user, session: { ...payload, expires_at: expiresAt } };
}
