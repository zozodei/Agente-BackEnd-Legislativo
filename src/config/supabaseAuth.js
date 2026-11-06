import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

/** Un cliente público por operación: las sesiones nunca se comparten entre usuarios. */
export function createAuthClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
