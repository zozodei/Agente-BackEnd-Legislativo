import { createAuthClient } from '../config/supabaseAuth.js';
import { unwrapAuth } from '../utils/authErrors.js';
import { env } from '../config/env.js';
import { createHash } from 'node:crypto';

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
