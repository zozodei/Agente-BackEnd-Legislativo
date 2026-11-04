import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/AppError.js';
import { paginated, toRange } from '../utils/pagination.js';
import { fetchAll, sanitizeSearch, unwrap } from '../utils/supabaseHelpers.js';
import { getDiputadosById } from './diputados.service.js';
import { extractPdfText } from './pdf.service.js';
import { calcularResultado } from './resultado.js';

/*
 * Las tablas poroteos / poroteo_votos tienen RLS sin políticas públicas:
 * solo se acceden con supabaseAdmin (clave secreta) desde este service.
 */

const POROTEO_COLUMNS =
  'id,titulo,descripcion,archivo_nombre,camara,tipo_mayoria,estado,origen,autor,metadata,created_at,updated_at';

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

async function fetchVotos(poroteoIds) {
  if (!poroteoIds.length) return [];
  return fetchAll(
    (from, to) =>
      supabaseAdmin
        .from('poroteo_votos')
        .select('poroteo_id,diputado_id,voto,origen,confianza,justificacion,fuentes,updated_at')
        .in('poroteo_id', poroteoIds)
        .order('poroteo_id')
        .order('diputado_id')
        .range(from, to),
    'poroteos.votos',
  );
}

export async function createPoroteo(
  { titulo, descripcion, textoProyecto, tipoMayoria, autor },
  archivo,
) {
  let texto = textoProyecto ?? null;
  if (archivo) {
    const extraido = await extractPdfText(archivo.buffer);
    texto = [texto, extraido].filter(Boolean).join('\n\n') || null;
  }

  const { data } = unwrap(
    await supabaseAdmin
      .from('poroteos')
      .insert({
        titulo,
        descripcion: descripcion ?? null,
        texto_proyecto: texto,
        archivo_nombre: archivo?.originalname ?? null,
        tipo_mayoria: tipoMayoria,
        autor: autor ?? null,
        camara: 'diputados',
        origen: 'manual',
      })
      .select(POROTEO_COLUMNS)
      .single(),
    'poroteos.create',
  );
  return getPoroteo(data.id);
}

export async function listPoroteos({ q, page, pageSize }) {
  const { from, to } = toRange(page, pageSize);
  let query = supabaseAdmin.from('poroteos').select(POROTEO_COLUMNS, { count: 'exact' });
  if (q) {
    const term = sanitizeSearch(q);
    if (term) query = query.ilike('titulo', `%${term}%`);
  }
  const { data, count } = unwrap(
    await query.order('updated_at', { ascending: false }).range(from, to),
    'poroteos.list',
  );

  const votos = await fetchVotos(data.map((p) => p.id));
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
  const { data: row } = unwrap(
    await supabaseAdmin
      .from('poroteos')
      .select(`${POROTEO_COLUMNS},texto_proyecto`)
      .eq('id', id)
      .maybeSingle(),
    'poroteos.get',
  );
  if (!row) throw AppError.notFound(`No existe el poroteo ${id}`);

  const votos = (await fetchVotos([id])).map(toVotoDTO);
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

  const { data } = unwrap(
    await supabaseAdmin.from('poroteos').update(patch).eq('id', id).select('id'),
    'poroteos.update',
  );
  if (!data.length) throw AppError.notFound(`No existe el poroteo ${id}`);
  return getPoroteo(id);
}

/**
 * Guarda los votos estimados.
 * - merge:   upsert de los diputados enviados.
 * - replace: borra todo y guarda solo los enviados.
 */
export async function saveVotos(id, { modo, votos }) {
  const { data: existe } = unwrap(
    await supabaseAdmin.from('poroteos').select('id').eq('id', id).maybeSingle(),
    'poroteos.exists',
  );
  if (!existe) throw AppError.notFound(`No existe el poroteo ${id}`);

  const diputados = await getDiputadosById();
  const desconocidos = votos.filter((v) => !diputados.has(v.diputadoId)).map((v) => v.diputadoId);
  if (desconocidos.length) {
    throw AppError.badRequest('Hay diputados que no existen', { diputadoIds: desconocidos });
  }

  if (modo === 'replace') {
    unwrap(
      await supabaseAdmin.from('poroteo_votos').delete().eq('poroteo_id', id),
      'poroteos.votos.delete',
    );
  }

  if (votos.length) {
    unwrap(
      await supabaseAdmin.from('poroteo_votos').upsert(
        votos.map((v) => ({
          poroteo_id: id,
          diputado_id: v.diputadoId,
          voto: v.voto,
          origen: v.origen,
          confianza: v.confianza ?? null,
          justificacion: v.justificacion ?? null,
          fuentes: v.fuentes ?? null,
        })),
        { onConflict: 'poroteo_id,diputado_id' },
      ),
      'poroteos.votos.upsert',
    );
  }

  // Toca updated_at del poroteo y recalcula su origen (manual / ia / mixto).
  const origenes = new Set((await fetchVotos([id])).map((v) => v.origen));
  const origen = origenes.has('ia') ? (origenes.has('manual') ? 'mixto' : 'ia') : 'manual';
  unwrap(await supabaseAdmin.from('poroteos').update({ origen }).eq('id', id), 'poroteos.touch');

  return getPoroteo(id);
}

export async function deletePoroteo(id) {
  const { data } = unwrap(
    await supabaseAdmin.from('poroteos').delete().eq('id', id).select('id'),
    'poroteos.delete',
  );
  if (!data.length) throw AppError.notFound(`No existe el poroteo ${id}`);
}
