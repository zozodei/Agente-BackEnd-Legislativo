import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

const options = { auth: { persistSession: false, autoRefreshToken: false } };

/** Cliente de lectura (clave pública, respeta RLS). Usar para todos los datos de ¿Cómo Votó?. */
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, options);

/**
 * Cliente con la clave secreta: saltea RLS.
 * Usar SOLO en services que leen/escriben las tablas propias (poroteos).
 */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, options);

/**
 * Cliente nuevo para operaciones de login con Google y refresh.
 * Se crea uno por request: supabase-js guarda la sesión en memoria del cliente
 * y no queremos que la sesión de un usuario quede pegada al cliente compartido.
 * Usa flowType "implicit" para generar la URL OAuth sin PKCE
 * (el backend no necesita guardar el code_verifier: el front recibe el token en el hash).
 */
export function createAuthClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      flowType: 'implicit',
    },
  });
}
