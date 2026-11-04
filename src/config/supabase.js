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
