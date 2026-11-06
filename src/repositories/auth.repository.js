import { createAuthClient } from '../config/supabaseAuth.js';
import { unwrapAuth } from '../utils/authErrors.js';

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
  return consultarAuth('auth.refresh', (auth) =>
    auth.refreshSession({ refresh_token: refreshToken }),
  );
}

export function getUsuario(accessToken) {
  return consultarAuth('auth.me', (auth) => auth.getUser(accessToken));
}

export function logout(accessToken) {
  // Es el método que signOut del SDK usa internamente. Recibe el JWT explícito,
  // sin setSession ni refresh implícito. El cliente usa la clave PÚBLICA, nunca admin.
  return consultarAuth('auth.logout', (auth) => auth.admin.signOut(accessToken, 'local'));
}
