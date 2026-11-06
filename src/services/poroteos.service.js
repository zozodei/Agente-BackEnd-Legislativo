import * as poroteosRepository from '../repositories/poroteos.repository.js';
import { AppError } from '../utils/AppError.js';
import { paginated } from '../utils/pagination.js';
import { getDiputadosById } from './diputados.service.js';
import { extractPdfText } from './pdf.service.js';
import { calcularResultado } from './resultado.js';

function toPoroteoDTO(row) {
  return {
    id: row.id,
    titulo: row.titulo,
    descripcion: row.descripcion,
    archivoNombre: row.archivo_nombre,
    camara: row.camara,
    tipoMayoria: row.tipo_mayoria,
    estado: row.estado,
    origen: row.origen,
    autor: row.autor,
    userId: row.user_id ?? null,
    metadata: row.metadata ?? {},
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
  usuario,
) {
  let texto = textoProyecto ?? null;
  if (archivo) {
    const extraido = await extractPdfText(archivo.buffer);
    texto = [texto, extraido].filter(Boolean).join('\n\n') || null;
  }

  const fila = {
    titulo,
    descripcion: descripcion ?? null,
    texto_proyecto: texto,
    archivo_nombre: archivo?.originalname ?? null,
    tipo_mayoria: tipoMayoria,
    autor: autor ?? usuario?.nombre ?? usuario?.email ?? null,
    camara: 'diputados',
    origen: 'manual',
  };
  // Solo se manda user_id con login: los poroteos anónimos no lo tocan
  // (así siguen funcionando aunque la migración de auth aún no esté aplicada).
  if (usuario?.id) fila.user_id = usuario.id;

  const data = await poroteosRepository.insertPoroteo(fila);
  return getPoroteo(data.id);
}

export async function listPoroteos({ q, page, pageSize }) {
  const { data, count } = await poroteosRepository.fetchPoroteos({ q, page, pageSize });

  const votos = await poroteosRepository.fetchVotos(data.map((p) => p.id));
  const votosPorPoroteo = new Map();
  for (const v of votos) {
    if (!votosPorPoroteo.has(v.poroteo_id)) votosPorPoroteo.set(v.poroteo_id, []);
    votosPorPoroteo.get(v.poroteo_id).push(v.voto);
  }

  return paginated(
    data.map((row) => ({
      ...toPoroteoDTO(row),
      resumen: calcularResultado(votosPorPoroteo.get(row.id) ?? [], row.tipo_mayoria),
    })),
    { page, pageSize, total: count ?? 0 },
  );
}

export async function getPoroteo(id) {
  const row = await poroteosRepository.fetchPoroteo(id);
  if (!row) throw AppError.notFound(`No existe el poroteo ${id}`);

  const votos = (await poroteosRepository.fetchVotos([id])).map(toVotoDTO);
  return {
    ...toPoroteoDTO(row),
    textoProyecto: row.texto_proyecto,
    votos,
    resumen: calcularResultado(
      votos.map((v) => v.voto),
      row.tipo_mayoria,
    ),
  };
}

export async function updatePoroteo(id, changes) {
  const patch = {};
  if (changes.titulo !== undefined) patch.titulo = changes.titulo;
  if (changes.descripcion !== undefined) patch.descripcion = changes.descripcion;
  if (changes.textoProyecto !== undefined) patch.texto_proyecto = changes.textoProyecto;
  if (changes.tipoMayoria !== undefined) patch.tipo_mayoria = changes.tipoMayoria;
  if (changes.estado !== undefined) patch.estado = changes.estado;
  if (changes.autor !== undefined) patch.autor = changes.autor;

  const data = await poroteosRepository.updatePoroteo(id, patch);
  if (!data.length) throw AppError.notFound(`No existe el poroteo ${id}`);
  return getPoroteo(id);
}

/**
 * Guarda los votos estimados.
 * - merge:   upsert de los diputados enviados.
 * - replace: borra todo y guarda solo los enviados.
 */
export async function saveVotos(id, { modo, votos }) {
  const existe = await poroteosRepository.fetchPoroteoId(id);
  if (!existe) throw AppError.notFound(`No existe el poroteo ${id}`);

  const diputados = await getDiputadosById();
  const desconocidos = votos.filter((v) => !diputados.has(v.diputadoId)).map((v) => v.diputadoId);
  if (desconocidos.length) {
    throw AppError.badRequest('Hay diputados que no existen', { diputadoIds: desconocidos });
  }

  if (modo === 'replace') {
    // Borrado y upsert separados: replace no es atómico (comportamiento existente).
    await poroteosRepository.deleteVotos(id);
  }

  if (votos.length) {
    await poroteosRepository.upsertVotos(
      votos.map((v) => ({
        poroteo_id: id,
        diputado_id: v.diputadoId,
        voto: v.voto,
        origen: v.origen,
        confianza: v.confianza ?? null,
        justificacion: v.justificacion ?? null,
        fuentes: v.fuentes ?? null,
      })),
    );
  }

  // Toca updated_at del poroteo y recalcula su origen (manual / ia / mixto).
  const origenes = new Set((await poroteosRepository.fetchVotos([id])).map((v) => v.origen));
  const origen = origenes.has('ia') ? (origenes.has('manual') ? 'mixto' : 'ia') : 'manual';
  await poroteosRepository.touchPoroteo(id, origen);

  return getPoroteo(id);
}

export async function deletePoroteo(id) {
  const data = await poroteosRepository.deletePoroteo(id);
  if (!data.length) throw AppError.notFound(`No existe el poroteo ${id}`);
}
