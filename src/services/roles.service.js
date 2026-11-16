import { env } from '../config/env.js';

// Techo explícito del alcance solicitado. Configurar otro email no lo habilita.
const HABILITADOS = new Set([
  'augustraver@gmail.com',
  'zoe@acquistapace.com.ar',
  'lucas.ioel.roitman@gmail.com',
]);

/**
 * Solo recibir identidades devueltas por Auth, nunca un body o claims decodificados.
 * Exige email habilitado, confirmado y en SUPERADMIN_EMAILS, y además que el UUID de
 * la cuenta esté en SUPERADMIN_USER_IDS: si Supabase autoconfirma emails, una cuenta
 * nueva registrada con un email habilitado no obtiene el rol.
 */
export function resolverRol(user, emails = env.SUPERADMIN_EMAILS, ids = env.SUPERADMIN_USER_IDS) {
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  const id = typeof user?.id === 'string' ? user.id.trim().toLowerCase() : '';
  const confirmado =
    typeof user?.email_confirmed_at === 'string' &&
    Number.isFinite(Date.parse(user.email_confirmed_at));
  return email &&
    id &&
    confirmado &&
    HABILITADOS.has(email) &&
    emails.some((value) => value.trim().toLowerCase() === email) &&
    ids.some((value) => value.trim().toLowerCase() === id)
    ? 'superadmin'
    : 'usuario';
}
