import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/AppError.js';

/** Búsqueda exacta, interna, solo luego de autorizar al dueño. Nunca crea cuentas. */
export async function buscarCuentaPorEmail(email) {
  const perPage = 100;
  for (let page = 1; ; page += 1) {
    let result;
    try {
      result = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    } catch {
      throw AppError.upstream('No se pudieron consultar las cuentas');
    }
    if (result.error || !Array.isArray(result.data?.users)) {
      throw AppError.upstream('No se pudieron consultar las cuentas');
    }
    const { users, nextPage, total } = result.data;
    const user = users.find((u) => u.email?.trim().toLowerCase() === email);
    if (user) return { id: user.id };
    if (
      users.length < perPage ||
      nextPage === null ||
      (Number.isInteger(total) && page * perPage >= total)
    )
      return null;
  }
}

/** Proyección mínima para participantes; nunca devuelve el objeto Auth al service. */
export async function getCuenta(id) {
  let result;
  try {
    result = await supabaseAdmin.auth.admin.getUserById(id);
  } catch {
    throw AppError.upstream('No se pudo consultar el participante');
  }
  if (result.error || !result.data?.user)
    throw AppError.upstream('No se pudo consultar el participante');
  return { email: result.data.user.email ?? null };
}
