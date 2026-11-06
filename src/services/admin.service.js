import * as adminRepository from '../repositories/admin.repository.js';
import { countPoroteos } from '../repositories/poroteos.repository.js';
import { getResumen as getResumenCamara } from './stats.service.js';
import { listPoroteos, getPoroteo } from './poroteos.service.js';
import { resolverRol } from './roles.service.js';
import { paginated } from '../utils/pagination.js';

export async function getResumen() {
  const [camara, total, borradores, finalizados] = await Promise.all([
    getResumenCamara(),
    countPoroteos(),
    countPoroteos('borrador'),
    countPoroteos('final'),
  ]);
  return {
    poroteos: { total, borradores, finalizados },
    diputados: camara.camara.diputados,
    bloques: camara.camara.bloques,
    votaciones: camara.votaciones.total,
  };
}

export async function listCuentas(params) {
  const { users, total } = await adminRepository.listCuentas(params);
  return paginated(
    users.map((user) => ({
      id: user.id,
      email: user.email ?? null,
      createdAt: user.created_at ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
      rol: resolverRol(user),
    })),
    { ...params, total },
  );
}

// Reutiliza reglas, DTOs y paginación; no cambia accesos de los endpoints habituales.
export { listPoroteos, getPoroteo };
