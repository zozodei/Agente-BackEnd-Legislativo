import { env } from '../config/env.js';

// Techo explícito del alcance solicitado. Configurar otro email no lo habilita.
const HABILITADOS = new Set([
  'augustraver@gmail.com',
  'zoe@acquistapace.com.ar',
  'lucas.ioel.roitman@gmail.com',
]);

/** Solo recibir identidades devueltas por Auth, nunca un body o claims decodificados. */
export function resolverRol(user, emails = env.SUPERADMIN_EMAILS) {
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  const confirmado =
    typeof user?.email_confirmed_at === 'string' &&
    Number.isFinite(Date.parse(user.email_confirmed_at));
  return email &&
    confirmado &&
    HABILITADOS.has(email) &&
    emails.some((value) => value.trim().toLowerCase() === email)
    ? 'superadmin'
    : 'usuario';
}
