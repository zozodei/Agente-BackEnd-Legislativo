import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/AppError.js';

/** Único uso de la API administrativa de cuentas: lectura paginada, solo servidor. */
export async function listCuentas({ page, pageSize }) {
  let result;
  try {
    result = await supabaseAdmin.auth.admin.listUsers({ page, perPage: pageSize });
  } catch {
    throw AppError.upstream('No se pudieron consultar las cuentas', { contexto: 'admin.cuentas' });
  }
  if (result.error || !Array.isArray(result.data?.users)) {
    // Nunca registrar el objeto Auth completo ni confundir una clave de servidor inválida con el JWT del usuario.
    throw AppError.upstream('No se pudieron consultar las cuentas', { contexto: 'admin.cuentas' });
  }
  const { users, total } = result.data;
  // Algunas respuestas de una única página omiten headers de paginación.
  // Una primera página incompleta prueba que se tienen todas las cuentas.
  const count =
    Number.isInteger(total) && total > 0
      ? total
      : page === 1 && users.length < pageSize
        ? users.length
        : total;
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    (users.length && count < (page - 1) * pageSize + users.length)
  ) {
    throw AppError.upstream('Paginación de cuentas incompleta', { contexto: 'admin.cuentas' });
  }
  return { users, total: count };
}
