import * as poroteosRepository from '../repositories/poroteos.repository.js';
import { AppError } from '../utils/AppError.js';
import { paginated } from '../utils/pagination.js';
import * as participantesRepository from '../repositories/participantes.repository.js';
import { extractPdfText } from './pdf.service.js';
import { calcularResultado } from './resultado.js';

function permisos(rol) {
  return {
    editar: ['dueno', 'colaborador'].includes(rol),
    administrarMiembros: rol === 'dueno',
    publicar: rol === 'dueno',
    eliminar: rol === 'dueno',
    salir: ['dueno', 'colaborador'].includes(rol),
  };
}

function toPoroteoDTO(row, publico = false) {
  if (typeof row.version === 'number' && !Number.isSafeInteger(row.version)) {
    throw AppError.upstream('No se pudo representar la versión del poroteo con precisión');
  }
  const rol = publico ? null : (row.membresia?.[0]?.rol ?? null);
  return {
    id: row.id,
    titulo: row.titulo,
    descripcion: row.descripcion,
    camara: row.camara,
    tipoMayoria: row.tipo_mayoria,
    estado: row.estado,
    origen: row.origen,
    ...(publico
      ? {}
      : { archivoNombre: row.archivo_nombre, autor: row.autor, metadata: row.metadata ?? {} }),
    visibilidad: row.visibilidad,
    version: row.version,
    rolActual: rol,
    permisos: permisos(rol),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toVotoDTO(row) {
  return {
    diputadoId: row.diputado_id,
    voto: row.voto,
    origen: row.origen,
    confianza: row.confianza === null ? null : Number(row.confianza),
    justificacion: row.justificacion,
    fuentes: row.fuentes,
    updatedAt: row.updated_at,
  };
}

export async function createPoroteo(
  { titulo, descripcion, textoProyecto, tipoMayoria, autor },
  archivo,
  userId,
) {
  exigirUsuario(userId);
  let texto = textoProyecto ?? null;
  if (archivo) {
    const extraido = await extractPdfText(archivo.buffer);
    texto = [texto, extraido].filter(Boolean).join('\n\n') || null;
  }

  const data = await poroteosRepository.insertPoroteo({
    user_id: userId,
    visibilidad: 'privado',
    titulo,
    descripcion: descripcion ?? null,
    texto_proyecto: texto,
    archivo_nombre: archivo?.originalname ?? null,
    tipo_mayoria: tipoMayoria,
    autor: autor ?? null,
    camara: 'diputados',
    origen: 'manual',
  });
  return getPoroteo(data.id, userId);
}

function exigirUsuario(userId) {
  if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Se requiere iniciar sesión');
}

export function listPoroteos(params, userId) {
  exigirUsuario(userId);
  return listar(params, () => poroteosRepository.fetchPoroteos(params, userId));
}

export function listPoroteosGlobal(params) {
  return listar(params, () => poroteosRepository.fetchPoroteosGlobal(params));
}

export function listPoroteosPublicos(params) {
  return listar(params, () => poroteosRepository.fetchPoroteosPublicos(params), true);
}

async function listar({ page, pageSize }, consultar, publico = false) {
  const { data, count } = await consultar();

  const votos = await poroteosRepository.fetchVotos(data.map((p) => p.id));
  const votosPorPoroteo = new Map();
  for (const v of votos) {
    if (!votosPorPoroteo.has(v.poroteo_id)) votosPorPoroteo.set(v.poroteo_id, []);
    votosPorPoroteo.get(v.poroteo_id).push(v.voto);
  }
  // No entregar filas cuyo alcance o versión cambió mientras se cargaban sus votos.
  const actual = await consultar();
  if (
    actual.count !== count ||
    actual.data.length !== data.length ||
    actual.data.some(
      (row, i) => row.id !== data[i].id || String(row.version) !== String(data[i].version),
    )
  ) {
    throw new AppError(
      409,
      'VERSION_CONFLICT',
      'El listado cambió mientras se cargaba. Volvé a consultarlo.',
    );
  }

  return paginated(
    data.map((row) => ({
      ...toPoroteoDTO(row, publico),
      resumen: calcularResultado(votosPorPoroteo.get(row.id) ?? [], row.tipo_mayoria),
    })),
    { page, pageSize, total: count ?? 0 },
  );
}

export function getPoroteo(id, userId) {
  exigirUsuario(userId);
  return obtener(id, () => poroteosRepository.fetchPoroteo(id, userId));
}

export function getPoroteoGlobal(id) {
  return obtener(id, () => poroteosRepository.fetchPoroteoGlobal(id));
}

export function getPoroteoPublico(id) {
  return obtener(id, () => poroteosRepository.fetchPoroteoPublico(id), true);
}

async function obtener(id, consultar, publico = false) {
  const row = await consultar();
  if (!row) throw AppError.notFound(`No existe el poroteo ${id}`);

  const votos = (await poroteosRepository.fetchVotos([id])).map((v) =>
    publico ? { diputadoId: v.diputado_id, voto: v.voto } : toVotoDTO(v),
  );
  // Una segunda lectura impide asociar una versión nueva con votos de una anterior.
  // También vuelve a comprobar membresía/visibilidad luego de cargar los votos.
  const actual = await consultar();
  if (!actual) throw AppError.notFound(`No existe el poroteo ${id}`);
  if (String(actual.version) !== String(row.version)) {
    throw new AppError(
      409,
      'VERSION_CONFLICT',
      'El poroteo cambió durante la lectura. Volvé a cargarlo.',
    );
  }
  return {
    ...toPoroteoDTO(row, publico),
    textoProyecto: row.texto_proyecto,
    votos,
    resumen: calcularResultado(
      votos.map((v) => v.voto),
      row.tipo_mayoria,
    ),
  };
}

export async function updatePoroteo(id, changes, userId) {
  const { version, ...campos } = changes;
  const nombres = { textoProyecto: 'texto_proyecto', tipoMayoria: 'tipo_mayoria' };
  const patch = Object.fromEntries(Object.entries(campos).map(([k, v]) => [nombres[k] ?? k, v]));
  const row = await poroteosRepository.mutarPoroteo(id, userId, version, 'actualizar', patch);
  return detalleMutado(id, userId, row);
}

async function detalleMutado(id, userId, row) {
  const dto = await getPoroteo(id, userId);
  if (String(dto.version) !== String(row.version)) {
    throw new AppError(
      409,
      'VERSION_CONFLICT',
      'Tu operación se guardó, pero otra persona volvió a modificar el poroteo. Revisá tus cambios antes de recargar.',
    );
  }
  return dto;
}

export async function saveVotos(id, { version, modo, votos }, userId) {
  const row = await poroteosRepository.mutarPoroteo(id, userId, version, 'guardar_votos', {
    modo,
    votos: votos.map((v) => ({
      diputado_id: v.diputadoId,
      voto: v.voto,
      origen: v.origen,
      confianza: v.confianza ?? null,
      justificacion: v.justificacion ?? null,
      fuentes: v.fuentes ?? null,
    })),
  });
  return detalleMutado(id, userId, row);
}

export async function deletePoroteo(id, { version }, userId) {
  await poroteosRepository.mutarPoroteo(id, userId, version, 'eliminar');
}

async function exigirDueno(id, userId) {
  exigirUsuario(userId);
  const row = await poroteosRepository.fetchPoroteo(id, userId);
  if (!row) throw AppError.notFound('No existe el poroteo');
  if (row.membresia?.[0]?.rol !== 'dueno')
    throw new AppError(403, 'FORBIDDEN', 'Esta operación requiere ser dueño del poroteo');
  return row;
}

export async function listMiembros(id, userId) {
  const row = await exigirDueno(id, userId);
  const miembros = await poroteosRepository.fetchMiembros(id);
  const data = await Promise.all(
    miembros.map(async (m) => ({
      userId: m.user_id,
      rol: m.rol,
      createdAt: m.created_at,
      ...(await participantesRepository.getCuenta(m.user_id)),
    })),
  );
  const actual = await exigirDueno(id, userId);
  if (String(row.version) !== String(actual.version))
    throw new AppError(
      409,
      'VERSION_CONFLICT',
      'El poroteo cambió. Volvé a cargar los participantes.',
    );
  return { miembros: data, version: row.version };
}

export async function agregarMiembro(id, { version, email, rol }, userId) {
  await exigirDueno(id, userId);
  const cuenta = await participantesRepository.buscarCuentaPorEmail(email);
  if (!cuenta) throw AppError.notFound('No existe una cuenta registrada con ese email');
  const row = await poroteosRepository.mutarPoroteo(id, userId, version, 'agregar_miembro', {
    user_id: cuenta.id,
    rol,
  });
  return detalleMutado(id, userId, row);
}

export async function cambiarMiembro(id, targetId, { version, rol }, userId) {
  const row = await poroteosRepository.mutarPoroteo(id, userId, version, 'cambiar_rol', {
    user_id: targetId,
    rol,
  });
  // Al degradarse a sí mismo puede seguir editando, pero ya no administra.
  return detalleMutado(id, userId, row);
}

export async function quitarMiembro(id, targetId, { version }, userId) {
  const row = await poroteosRepository.mutarPoroteo(id, userId, version, 'quitar_miembro', {
    user_id: targetId,
  });
  if (targetId === userId) return { id, salido: true, version: row.version };
  return detalleMutado(id, userId, row);
}

export async function salirPoroteo(id, { version }, userId) {
  const row = await poroteosRepository.mutarPoroteo(id, userId, version, 'salir');
  return { id, salido: true, version: row.version };
}
