import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Se ejercitan rutas, controllers, services y repositories reales. Solo se dobla
// el cliente de datos y la extracción PDF: ninguna consulta sale a la red.
vi.mock('../src/config/supabase.js', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
  supabaseAdmin: { from: vi.fn() },
  createAuthClient: vi.fn(),
}));
vi.mock('../src/services/pdf.service.js', () => ({ extractPdfText: vi.fn() }));
// La verificación del token se dobla: /poroteos exige sesión.
vi.mock('../src/services/auth.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verificarToken: vi.fn(),
}));

const { supabase, supabaseAdmin } = await import('../src/config/supabase.js');
const { clearDiputadosCache } = await import('../src/services/diputados.service.js');
const { extractPdfText } = await import('../src/services/pdf.service.js');
const { verificarToken } = await import('../src/services/auth.service.js');
const { createApp } = await import('../src/app.js');
const { fetchVotos } = await import('../src/repositories/poroteos.repository.js');
const { fetchVotosVotacion } = await import('../src/repositories/votaciones.repository.js');

const app = createApp();
const USUARIO = {
  id: '0b5d7c1e-2f3a-4b5c-8d9e-0123456789ab',
  email: 'ana@example.org',
  nombre: 'Ana Test',
};
const BEARER = 'Bearer token-valido';
const UUID = '6f1c2a4e-1b2c-4d3e-8f90-123456789abc';
const path = `/api/poroteos/${UUID}`;
const poroteo = {
  id: UUID,
  titulo: 'Ley de prueba',
  descripcion: null,
  archivo_nombre: null,
  texto_proyecto: 'Texto',
  camara: 'diputados',
  tipo_mayoria: 'simple',
  estado: 'borrador',
  origen: 'manual',
  autor: null,
  metadata: {},
  created_at: '2026-11-01',
  updated_at: '2026-11-06',
};
const diputado = {
  id: 1,
  apellido: 'Álvarez',
  nombre: 'Ana',
  nombre_completo: 'Ana Álvarez',
  distrito: 'CÓRDOBA',
  bloque: 'PRO',
  persona_id: 10,
  foto_url: '/foto.jpg',
  presentismo: '80.5',
  alin_pj: null,
  alin_pro: '90',
  finaliza_mandato: '2027-12-10',
};
const voto = {
  poroteo_id: UUID,
  diputado_id: 1,
  voto: 'AFIRMATIVO',
  origen: 'manual',
  confianza: null,
  justificacion: null,
  fuentes: null,
  updated_at: '2026-11-06',
};

function query(result) {
  const q = {};
  for (const method of [
    'select',
    'eq',
    'in',
    'order',
    'range',
    'limit',
    'or',
    'ilike',
    'gte',
    'lte',
    'maybeSingle',
    'single',
    'insert',
    'update',
    'delete',
    'upsert',
  ]) {
    q[method] = vi.fn(() => q);
  }
  q.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return q;
}

function enqueue(client, table, data, extra = {}) {
  const q = query({ data, error: null, ...extra });
  client.from.mockImplementationOnce((actual) => {
    expect(actual).toBe(table);
    return q;
  });
  return q;
}

function detail(votos = [voto]) {
  enqueue(supabaseAdmin, 'poroteos', poroteo);
  enqueue(supabaseAdmin, 'poroteo_votos', votos);
}

beforeEach(() => {
  vi.resetAllMocks();
  verificarToken.mockResolvedValue(USUARIO);
  clearDiputadosCache();
  supabase.from.mockImplementation(() => {
    throw new Error('Consulta de lectura inesperada');
  });
  supabaseAdmin.from.mockImplementation(() => {
    throw new Error('Consulta admin inesperada');
  });
});

describe('Poroteos a través de todas las capas', () => {
  it('sin token responde 401 y no consulta la base', async () => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('filtra el detalle por el usuario de la sesión (uno ajeno da 404)', async () => {
    const consulta = enqueue(supabaseAdmin, 'poroteos', null);
    const res = await request(app).get(path).set('Authorization', BEARER);
    expect(res.status).toBe(404);
    expect(consulta.eq).toHaveBeenCalledWith('user_id', USUARIO.id);
  });

  it('mantiene detalle camelCase y resultado calculado', async () => {
    detail([{ ...voto, confianza: '0.750' }]);
    const res = await request(app).get(path).set('Authorization', BEARER);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: UUID,
      titulo: poroteo.titulo,
      descripcion: null,
      archivoNombre: null,
      textoProyecto: 'Texto',
      camara: 'diputados',
      tipoMayoria: 'simple',
      estado: 'borrador',
      origen: 'manual',
      autor: null,
      metadata: {},
      createdAt: '2026-11-01',
      updatedAt: '2026-11-06',
      votos: [
        {
          diputadoId: 1,
          voto: 'AFIRMATIVO',
          origen: 'manual',
          confianza: 0.75,
          justificacion: null,
          fuentes: null,
          updatedAt: '2026-11-06',
        },
      ],
      resumen: {
        tipoMayoria: 'simple',
        conteo: {
          AFIRMATIVO: 1,
          NEGATIVO: 0,
          ABSTENCION: 0,
          AUSENTE: 0,
          INDEFINIDO: 0,
          sinAsignar: 256,
        },
        presentes: 1,
        enDisputa: 256,
        quorum: { requerido: 129, alcanzado: false, faltan: 128 },
        mayoria: { requeridos: 1, faltan: 0 },
        resultado: 'SIN_QUORUM',
        escenarios: { mejorCaso: 'APROBADO', peorCaso: 'RECHAZADO' },
        definido: false,
      },
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it.each(['merge', 'replace'])(
    'guarda %s y recalcula el origen desde todos los votos',
    async (modo) => {
      enqueue(supabaseAdmin, 'poroteos', { id: UUID });
      enqueue(supabase, 'v_diputados_actuales', [diputado]);
      const borrado = modo === 'replace' ? enqueue(supabaseAdmin, 'poroteo_votos', null) : null;
      const escritura = enqueue(supabaseAdmin, 'poroteo_votos', null);
      enqueue(supabaseAdmin, 'poroteo_votos', [voto, { ...voto, diputado_id: 2, origen: 'ia' }]);
      const touch = enqueue(supabaseAdmin, 'poroteos', null);
      detail();
      const res = await request(app)
        .put(`${path}/votos`)
        .set('Authorization', BEARER)
        .send({ modo, votos: [{ diputadoId: 1, voto: 'AFIRMATIVO' }] });
      expect(res.status).toBe(200);
      expect(res.body.data.votos[0].diputadoId).toBe(1);
      expect(escritura.upsert).toHaveBeenCalledWith(
        [
          {
            poroteo_id: UUID,
            diputado_id: 1,
            voto: 'AFIRMATIVO',
            origen: 'manual',
            confianza: null,
            justificacion: null,
            fuentes: null,
          },
        ],
        { onConflict: 'poroteo_id,diputado_id' },
      );
      expect(touch.update).toHaveBeenCalledWith({ origen: 'mixto' });
      if (borrado) {
        expect(borrado.delete).toHaveBeenCalledOnce();
        expect(borrado.eq).toHaveBeenCalledWith('poroteo_id', UUID);
        expect(borrado.delete.mock.invocationCallOrder[0]).toBeLessThan(
          escritura.upsert.mock.invocationCallOrder[0],
        );
      } else {
        expect(supabaseAdmin.from).toHaveBeenCalledTimes(6);
        expect(escritura.delete).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['merge', 'replace'])(
    '%s valida diputados antes de cualquier modificación',
    async (modo) => {
      const existe = enqueue(supabaseAdmin, 'poroteos', { id: UUID });
      enqueue(supabase, 'v_diputados_actuales', [diputado]);
      const res = await request(app)
        .put(`${path}/votos`)
        .set('Authorization', BEARER)
        .send({ modo, votos: [{ diputadoId: 99, voto: 'NEGATIVO' }] });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: {
          code: 'BAD_REQUEST',
          message: 'Hay diputados que no existen',
          details: { diputadoIds: [99] },
        },
      });
      expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
      expect(existe.delete).not.toHaveBeenCalled();
      expect(existe.update).not.toHaveBeenCalled();
    },
  );

  it('replace vacío borra sin upsert y deja origen manual', async () => {
    enqueue(supabaseAdmin, 'poroteos', { id: UUID });
    enqueue(supabase, 'v_diputados_actuales', [diputado]);
    const borrado = enqueue(supabaseAdmin, 'poroteo_votos', null);
    enqueue(supabaseAdmin, 'poroteo_votos', []);
    const touch = enqueue(supabaseAdmin, 'poroteos', null);
    detail([]);
    const res = await request(app)
      .put(`${path}/votos`)
      .set('Authorization', BEARER)
      .send({ modo: 'replace', votos: [] });
    expect(res.status).toBe(200);
    expect(borrado.delete).toHaveBeenCalledOnce();
    expect(touch.update).toHaveBeenCalledWith({ origen: 'manual' });
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(6);
    expect(res.body.data.resumen.enDisputa).toBe(257);
  });

  it('no oculta el fallo de upsert posterior al borrado de replace', async () => {
    enqueue(supabaseAdmin, 'poroteos', { id: UUID });
    enqueue(supabase, 'v_diputados_actuales', [diputado]);
    const borrado = enqueue(supabaseAdmin, 'poroteo_votos', null);
    enqueue(supabaseAdmin, 'poroteo_votos', null, {
      error: { code: '23503', message: 'Detalle privado' },
    });
    const res = await request(app)
      .put(`${path}/votos`)
      .set('Authorization', BEARER)
      .send({ modo: 'replace', votos: [{ diputadoId: 1, voto: 'AFIRMATIVO' }] });
    expect(borrado.delete).toHaveBeenCalledOnce();
    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      error: {
        code: 'UPSTREAM_ERROR',
        message: 'Error consultando la base de datos',
        details: { contexto: 'poroteos.votos.upsert' },
      },
    });
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(3);
  });

  it('poroteo inexistente no consulta diputados ni modifica votos', async () => {
    enqueue(supabaseAdmin, 'poroteos', null);
    const res = await request(app)
      .put(`${path}/votos`)
      .set('Authorization', BEARER)
      .send({ votos: [] });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(`No existe el poroteo ${UUID}`);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
  });

  it('combina texto pegado y PDF, conserva Location y el nombre sin almacenar el archivo', async () => {
    extractPdfText.mockResolvedValue('Texto extraído');
    const insert = enqueue(supabaseAdmin, 'poroteos', { id: UUID });
    detail([]);
    const res = await request(app)
      .post('/api/poroteos')
      .set('Authorization', BEARER)
      .field('titulo', 'Ley de prueba')
      .field('textoProyecto', 'Texto pegado')
      .attach('archivo', Buffer.from('%PDF-prueba'), {
        filename: 'proyecto.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(path);
    expect(extractPdfText).toHaveBeenCalledWith(Buffer.from('%PDF-prueba'));
    expect(insert.insert).toHaveBeenCalledWith({
      titulo: 'Ley de prueba',
      descripcion: null,
      texto_proyecto: 'Texto pegado\n\nTexto extraído',
      archivo_nombre: 'proyecto.pdf',
      tipo_mayoria: 'simple',
      autor: 'Ana Test',
      user_id: USUARIO.id,
      camara: 'diputados',
      origen: 'manual',
    });
  });

  it('mantiene el límite de PDF de 10 MB', async () => {
    const res = await request(app)
      .post('/api/poroteos')
      .set('Authorization', BEARER)
      .field('titulo', 'Ley de prueba')
      .attach('archivo', Buffer.alloc(10 * 1024 * 1024 + 1), {
        filename: 'grande.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('El archivo supera el tamaño máximo (10 MB)');
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(extractPdfText).not.toHaveBeenCalled();
  });

  it('PATCH transforma campos y DELETE conserva 204 sin cuerpo', async () => {
    const patch = enqueue(supabaseAdmin, 'poroteos', [{ id: UUID }]);
    detail([]);
    const res = await request(app)
      .patch(path)
      .set('Authorization', BEARER)
      .send({ textoProyecto: 'Nuevo', tipoMayoria: 'absoluta', descripcion: null });
    expect(res.status).toBe(200);
    expect(patch.update).toHaveBeenCalledWith({
      texto_proyecto: 'Nuevo',
      tipo_mayoria: 'absoluta',
      descripcion: null,
    });
    enqueue(supabaseAdmin, 'poroteos', [{ id: UUID }]);
    const removed = await request(app).delete(path).set('Authorization', BEARER);
    expect(removed.status).toBe(204);
    expect(removed.text).toBe('');
  });

  it('lista con paginación, búsqueda escapada y resumen', async () => {
    const listado = enqueue(supabaseAdmin, 'poroteos', [poroteo], { count: 21 });
    enqueue(supabaseAdmin, 'poroteo_votos', [voto]);
    const res = await request(app)
      .get('/api/poroteos')
      .set('Authorization', BEARER)
      .query({ q: 'Ley%_', page: 2, pageSize: 20 });
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 2, pageSize: 20, total: 21, totalPages: 2 });
    expect(res.body.data[0].resumen.conteo.AFIRMATIVO).toBe(1);
    expect(listado.eq).toHaveBeenCalledWith('user_id', USUARIO.id);
    expect(listado.ilike).toHaveBeenCalledWith('titulo', '%Ley\\%\\_%');
    expect(listado.range).toHaveBeenCalledWith(20, 39);
  });
});

describe('Consultas completas y traducción de errores', () => {
  it.each([
    ['votos propios', supabaseAdmin, 'poroteo_votos', () => fetchVotos([UUID])],
    ['votos históricos', supabase, 'v_votos', () => fetchVotosVotacion(1)],
  ])('pagina más de 1000 filas: %s', async (_nombre, client, table, ejecutar) => {
    const primera = enqueue(
      client,
      table,
      Array.from({ length: 1000 }, (_, id) => ({ id })),
    );
    const segunda = enqueue(client, table, [{ id: 1000 }]);
    const result = await ejecutar();
    expect(result).toHaveLength(1001);
    expect(result[1000]).toEqual({ id: 1000 });
    expect(primera.range).toHaveBeenCalledWith(0, 999);
    expect(segunda.range).toHaveBeenCalledWith(1000, 1999);
  });

  it.each([
    ['PGRST205', 503, 'SERVICE_UNAVAILABLE'],
    ['42501', 502, 'UPSTREAM_ERROR'],
  ])('%s llega al HTTP como %s', async (code, status, apiCode) => {
    enqueue(supabaseAdmin, 'poroteos', null, { error: { code, message: 'Detalle privado' } });
    const res = await request(app).get(path).set('Authorization', BEARER);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(apiCode);
    expect(res.body.error.details).toEqual({ contexto: 'poroteos.get' });
    expect(JSON.stringify(res.body)).not.toContain('Detalle privado');
  });

  it('propaga un fallo en la segunda página sin devolver datos parciales', async () => {
    enqueue(supabaseAdmin, 'poroteo_votos', Array(1000).fill(voto));
    enqueue(supabaseAdmin, 'poroteo_votos', null, { error: { code: '42501' } });
    await expect(fetchVotos([UUID])).rejects.toMatchObject({ status: 502, code: 'UPSTREAM_ERROR' });
  });
});

describe('Datos históricos y coordinación de servicios', () => {
  it('conserva caché, filtros sin tildes y catálogos derivados', async () => {
    enqueue(supabase, 'v_diputados_actuales', [diputado]);
    const res = await request(app).get('/api/diputados?q=alvarez&distrito=cordoba&bloque=pro');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      id: 1,
      personaId: 10,
      presentismo: 80.5,
      alineamiento: { pro: 90, pj: null },
    });
    expect(res.body.meta).toEqual({ page: 1, pageSize: 300, total: 1, totalPages: 1 });
    expect((await request(app).get('/api/bloques')).body).toEqual({
      data: [{ nombre: 'PRO', bancas: 1 }],
    });
    expect((await request(app).get('/api/distritos')).body).toEqual({
      data: [{ nombre: 'CÓRDOBA', bancas: 1 }],
    });
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('mantiene el fallback solo para la RPC de alineación ausente', async () => {
    enqueue(supabase, 'v_diputados_actuales', diputado);
    enqueue(supabase, 'cv_mandatos', []);
    supabase.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    const res = await request(app).get('/api/diputados/1');
    expect(res.status).toBe(200);
    expect(res.body.data.estadisticas.alineacionBloque).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith('fn_alineacion_bloque', {
      p_persona_id: 10,
      p_solo_general: false,
    });
  });

  it('otros errores de alineación no se convierten en null', async () => {
    enqueue(supabase, 'v_diputados_actuales', diputado);
    enqueue(supabase, 'cv_mandatos', []);
    supabase.rpc.mockResolvedValue({ error: { code: '42501' } });
    expect((await request(app).get('/api/diputados/1')).status).toBe(502);
  });

  it('mantiene los filtros y el orden del historial por persona', async () => {
    enqueue(supabase, 'v_diputados_actuales', [diputado]);
    const historial = enqueue(
      supabase,
      'v_votos',
      [{ votacion_id: 2, nombre_ley: 'Ley', voto: 'NEGATIVO' }],
      { count: 26 },
    );
    const res = await request(app).get(
      '/api/diputados/1/votos?q=Ley&voto=NEGATIVO&anio=2026&soloGeneral=true&page=2',
    );
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ votacionId: 2, nombreLey: 'Ley', voto: 'NEGATIVO' });
    expect(res.body.meta).toEqual({ page: 2, pageSize: 25, total: 26, totalPages: 2 });
    expect(historial.eq).toHaveBeenCalledWith('persona_id', 10);
    expect(historial.eq).toHaveBeenCalledWith('etiqueta', 'En General');
    expect(historial.eq).toHaveBeenCalledWith('voto', 'NEGATIVO');
    expect(historial.eq).toHaveBeenCalledWith('anio', 2026);
    expect(historial.range).toHaveBeenCalledWith(25, 49);
  });

  it('mantiene filtros, orden y limpieza del resultado de votaciones', async () => {
    const listado = enqueue(
      supabase,
      'cv_votaciones',
      [
        {
          id: 2,
          titulo: 'Acta',
          titulo_sitio: 'Ley',
          resultado: '218',
          afirmativos: 3,
          negativos: 1,
        },
      ],
      { count: 21 },
    );
    const res = await request(app).get('/api/votaciones').query({
      q: 'Ley,(*)',
      desde: '2026-01-01',
      hasta: '2026-11-06',
      anio: 2026,
      resultado: 'AFIRMATIVO',
      soloGeneral: true,
      page: 2,
      pageSize: 20,
    });
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      titulo: 'Ley',
      tituloActa: 'Acta',
      resultado: null,
      resultadoOriginal: '218',
      porcentajes: { afirmativos: 75, negativos: 25, abstenciones: 0, ausentes: 0 },
    });
    expect(listado.eq).toHaveBeenCalledWith('camara', 'diputados');
    expect(listado.eq).toHaveBeenCalledWith('es_general', true);
    expect(listado.eq).toHaveBeenCalledWith('anio', 2026);
    expect(listado.eq).toHaveBeenCalledWith('resultado', 'AFIRMATIVO');
    expect(listado.or).toHaveBeenCalledWith(
      'titulo.ilike.%Ley%,titulo_sitio.ilike.%Ley%,nombre_ley.ilike.%Ley%',
    );
    expect(listado.gte).toHaveBeenCalledWith('fecha', '2026-01-01T00:00:00');
    expect(listado.lte).toHaveBeenCalledWith('fecha', '2026-11-06T23:59:59');
    expect(listado.order.mock.calls).toEqual([
      ['fecha', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(listado.range).toHaveBeenCalledWith(20, 39);
  });

  it('detalle enriquece votos con fotos, ley y resumen por bloque', async () => {
    enqueue(supabase, 'cv_votaciones', {
      id: 1,
      titulo: 'Acta',
      ley_id: 3,
      resultado: 'AFIRMATIVO',
    });
    enqueue(supabase, 'v_votos', [
      {
        persona_id: 10,
        legislador: 'Ana',
        diputado_actual_id: 1,
        bloque: 'PRO',
        voto: 'AFIRMATIVO',
      },
    ]);
    enqueue(supabase, 'v_personas', [{ id: 10, foto_url: '/foto.jpg' }]);
    enqueue(supabase, 'cv_leyes', {
      id: 3,
      nombre: 'Nombre',
      nombre_comun: 'Ley común',
      cantidad_votaciones: 1,
    });
    const hermanas = enqueue(supabase, 'cv_votaciones', [
      { id: 1, es_general: true, resultado: '218' },
    ]);
    const res = await request(app).get('/api/votaciones/1');
    expect(res.status).toBe(200);
    expect(res.body.data.ley).toMatchObject({ id: 3, nombre: 'Ley común', cantidadVotaciones: 1 });
    expect(res.body.data.votos[0]).toMatchObject({
      personaId: 10,
      diputadoId: 1,
      fotoUrl: '/foto.jpg',
    });
    expect(res.body.data.porBloque).toEqual([
      {
        bloque: 'PRO',
        AFIRMATIVO: 1,
        NEGATIVO: 0,
        ABSTENCION: 0,
        AUSENTE: 0,
        PRESIDENTE: 0,
        total: 1,
      },
    ]);
    expect(res.body.data.votacionesDeLaLey[0]).toMatchObject({ esGeneral: true, resultado: null });
    expect(hermanas.limit).toHaveBeenCalledWith(200);
  });

  it('estadísticas coordina datos históricos sin usar el cliente admin', async () => {
    enqueue(supabase, 'v_diputados_actuales', [diputado]);
    // Catálogos comparte la promesa de la caché de diputados.
    const ultimas = enqueue(supabase, 'cv_votaciones', []);
    for (const count of [12, 7, 5, 2]) enqueue(supabase, 'cv_votaciones', null, { count });
    enqueue(supabase, 'cv_meta', [{ clave: 'stats_sitio', valor: { last_updated: '2026-11-01' } }]);
    const res = await request(app).get('/api/stats/resumen');
    expect(res.status).toBe(200);
    expect(res.body.data.camara).toMatchObject({
      bancas: 257,
      diputados: 1,
      quorum: 129,
      presentismoPromedio: 80.5,
      mandatosQueVencen: { 2027: 1 },
    });
    expect(res.body.data.votaciones).toEqual({
      total: 12,
      aprobadas: 7,
      rechazadas: 5,
      anioActual: { anio: new Date().getFullYear(), total: 2 },
      ultimas: [],
    });
    expect(res.body.data.fuente.actualizado).toBe('2026-11-01');
    expect(ultimas.limit).toHaveBeenCalledWith(6);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});
