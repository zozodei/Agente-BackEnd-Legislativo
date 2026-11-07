import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/supabaseAuth.js', () => ({ createAuthClient: vi.fn() }));
vi.mock('../src/config/env.js', async (original) => {
  const actual = await original();
  return {
    ...actual,
    env: {
      ...actual.env,
      RATE_LIMIT_WRITE_MAX: 10000,
      SUPERADMIN_EMAILS: ['zoe@acquistapace.com.ar'],
    },
  };
});
vi.mock('../src/config/supabase.js', () => ({
  supabase: { from: vi.fn() },
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { admin: { listUsers: vi.fn(), getUserById: vi.fn() } },
  },
}));
const { createAuthClient } = await import('../src/config/supabaseAuth.js');
const { supabase, supabaseAdmin: db } = await import('../src/config/supabase.js');
const { createApp } = await import('../src/app.js');
const app = createApp();
const [A, B, C, D, P, Q] = [1, 2, 3, 4, 5, 6].map(
  (n) =>
    `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`,
);
const url = `/api/poroteos/${P}`;
const own = (method, path = url, actor = A) =>
  request(app)[method](path).set('Authorization', `Bearer ${actor}`);
const cuenta = (id) => ({
  id,
  email: id === A ? 'zoe@acquistapace.com.ar' : `${id[0]}@example.org`,
  email_confirmed_at: '2026-11-01',
  private: 'auth-interno',
});
let rows, miembros, votos, calls;

// Doble relacional: filtra por membresía antes de contar y paginar, sin red.
function query(table) {
  let single = false,
    range,
    payload,
    actor;
  const filters = [];
  const q = {
    select: () => q,
    eq: (key, value) => {
      if (key === 'membresia.user_id') actor = value;
      else filters.push((r) => r[key] === value);
      return q;
    },
    in: (key, values) => {
      filters.push((r) => values.includes(r[key]));
      return q;
    },
    ilike: (key, value) => {
      filters.push((r) => r[key].includes(value.replaceAll('%', '')));
      return q;
    },
    order: () => q,
    range: (from, to) => {
      range = [from, to];
      return q;
    },
    maybeSingle: () => {
      single = true;
      return q;
    },
    single: () => {
      single = true;
      return q;
    },
    insert: (data) => {
      payload = data;
      return q;
    },
    then: (resolve, reject) =>
      Promise.resolve()
        .then(() => {
          calls.push({ table, operation: payload ? 'insert' : 'select' });
          if (payload) {
            const row = { ...rows[0], ...payload, id: D, version: 2 };
            rows.push(row);
            miembros.push({ poroteo_id: D, user_id: payload.user_id, rol: 'dueno' });
            return { data: { ...row, version: 1 }, error: null };
          }
          const source =
            table === 'poroteos' ? rows : table === 'poroteo_usuarios' ? miembros : votos;
          let data = source.filter((r) => filters.every((f) => f(r)));
          if (actor)
            data = data.flatMap((r) => {
              const m = miembros.find((m) => m.poroteo_id === r.id && m.user_id === actor);
              return m ? [{ ...r, membresia: [{ rol: m.rol }] }] : [];
            });
          const count = data.length;
          if (range) data = data.slice(range[0], range[1] + 1);
          return { data: structuredClone(single ? (data[0] ?? null) : data), count, error: null };
        })
        .then(resolve, reject),
  };
  return q;
}

// Modelo del contrato transaccional. No sustituye una prueba del motor Postgres.
function rpc(_name, p) {
  const error = (code, message = '') => ({ data: null, error: { code, message } });
  const row = rows.find((r) => r.id === p.p_poroteo_id);
  const m = miembros.find((m) => m.poroteo_id === row?.id && m.user_id === p.p_actor_id);
  if (!m) return error('PT404');
  if (String(row.version) !== String(p.p_version)) return error('PT409');
  const { p_accion: action, p_datos: data } = p;
  if (
    (['agregar_miembro', 'cambiar_rol', 'quitar_miembro', 'eliminar'].includes(action) ||
      (action === 'actualizar' && 'visibilidad' in data)) &&
    m.rol !== 'dueno'
  )
    return error('PT403');
  const snapshot = structuredClone({ rows, miembros, votos });
  if (action === 'actualizar') Object.assign(row, data);
  if (action === 'guardar_votos') {
    if (data.modo === 'replace') votos = votos.filter((v) => v.poroteo_id !== row.id);
    for (const v of data.votos) {
      if (v.diputado_id > 257) {
        ({ rows, miembros, votos } = snapshot);
        return error('PT400');
      }
      votos = votos.filter((old) => old.poroteo_id !== row.id || old.diputado_id !== v.diputado_id);
      votos.push({ ...v, poroteo_id: row.id });
    }
    const tipos = new Set(votos.filter((v) => v.poroteo_id === row.id).map((v) => v.origen));
    row.origen = tipos.has('ia') ? (tipos.has('manual') ? 'mixto' : 'ia') : 'manual';
  }
  const target = action === 'salir' ? m.user_id : data.user_id;
  const objetivo = miembros.find((x) => x.poroteo_id === row.id && x.user_id === target);
  if (action === 'agregar_miembro') {
    if (objetivo) return error('23505');
    miembros.push({ poroteo_id: row.id, user_id: target, rol: data.rol });
  }
  if (['cambiar_rol', 'quitar_miembro', 'salir'].includes(action)) {
    if (!objetivo) return error('PT404');
    if (
      objetivo.rol === 'dueno' &&
      (action !== 'cambiar_rol' || data.rol !== 'dueno') &&
      miembros.filter((x) => x.poroteo_id === row.id && x.rol === 'dueno').length === 1
    )
      return error('23514', 'ULTIMO_DUENO');
    if (action === 'cambiar_rol') objetivo.rol = data.rol;
    else miembros = miembros.filter((x) => x !== objetivo);
  }
  if (action === 'eliminar') {
    rows = rows.filter((r) => r.id !== row.id);
    votos = votos.filter((v) => v.poroteo_id !== row.id);
    miembros = miembros.filter((m) => m.poroteo_id !== row.id);
    return { data: { id: row.id, eliminado: true }, error: null };
  }
  row.version += 1;
  return { data: { ...row }, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  rows = [P, Q].map((id, i) => ({
    id,
    user_id: A,
    titulo: `Proyecto ${i}`,
    tipo_mayoria: 'simple',
    camara: 'diputados',
    estado: 'borrador',
    origen: 'manual',
    version: 3,
    visibilidad: i ? 'publico' : 'privado',
    texto_proyecto: 'Texto visible',
    metadata: { secreto: true },
    autor: 'autor privado',
    archivo_nombre: 'privado.pdf',
  }));
  miembros = [
    { poroteo_id: P, user_id: A, rol: 'dueno' },
    { poroteo_id: P, user_id: B, rol: 'dueno' },
    { poroteo_id: P, user_id: C, rol: 'colaborador' },
    { poroteo_id: Q, user_id: B, rol: 'dueno' },
  ];
  votos = [
    { poroteo_id: P, diputado_id: 1, voto: 'AFIRMATIVO', origen: 'manual', fuentes: ['secreto'] },
    { poroteo_id: Q, diputado_id: 2, voto: 'NEGATIVO', origen: 'manual', fuentes: ['secreto'] },
  ];
  createAuthClient.mockReturnValue({
    auth: {
      getUser: vi.fn(async (token) => ({
        data: { user: [A, B, C, D].includes(token) ? cuenta(token) : null },
        error: null,
      })),
    },
  });
  db.from.mockImplementation(query);
  db.rpc.mockImplementation(rpc);
  db.auth.admin.listUsers.mockResolvedValue({
    data: { users: [A, B, C, D].map(cuenta), total: 4 },
    error: null,
  });
  db.auth.admin.getUserById.mockImplementation(async (id) => ({
    data: { user: cuenta(id) },
    error: null,
  }));
});

describe('Colaboración, publicación y concurrencia', () => {
  it.each([A, B, C])('miembro %s lee, edita y aparece en mis poroteos', async (actor) => {
    const list = await own('get', '/api/poroteos?pageSize=1', actor);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(actor === B ? 2 : 1);
    expect(list.body.data[0].permisos.editar).toBe(true);
    expect((await own('get', url, actor)).status).toBe(200);
    const patch = await own('patch', url, actor).send({ version: 3, titulo: 'Editado' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.version).toBe(4);
  });
  it('ajeno recibe 404 y no obtiene votos; creador sin membresía tampoco edita', async () => {
    expect((await own('get', url, D)).status).toBe(404);
    expect(calls.some((c) => c.table === 'poroteo_votos')).toBe(false);
    for (const actor of [A, D]) {
      const path = actor === A ? `/api/poroteos/${Q}` : url;
      expect(
        (await own('patch', path, actor).send({ version: 3, titulo: 'Intrusión' })).status,
      ).toBe(404);
      expect(
        (await own('put', `${path}/votos`, actor).send({ version: 3, votos: [] })).status,
      ).toBe(404);
      expect((await own('delete', path, actor).send({ version: 3 })).status).toBe(404);
    }
    expect((await own('get', `/api/admin/poroteos/${Q}`)).status).toBe(200);
    expect((await own('get', '/api/admin/poroteos')).body.meta.total).toBe(2);
    expect((await own('get', '/api/admin/poroteos', B)).status).toBe(403);
  });
  it('lectura pública anónima excluye información interna', async () => {
    const list = await request(app).get('/api/poroteos-publicos');
    const detail = await request(app).get(`/api/poroteos-publicos/${Q}`);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(1);
    expect(detail.status).toBe(200);
    expect(detail.headers['cache-control']).toBe('no-store');
    expect(detail.body.data).toMatchObject({
      textoProyecto: 'Texto visible',
      permisos: { editar: false },
    });
    expect(detail.body.data.votos).toEqual([{ diputadoId: 2, voto: 'NEGATIVO' }]);
    for (const obj of [detail.body.data, list.body.data[0]])
      for (const key of [
        'metadata',
        'autor',
        'archivoNombre',
        'user_id',
        'userId',
        'email',
        'miembros',
        'membresia',
      ])
        expect(obj).not.toHaveProperty(key);
    expect((await request(app).get(`/api/poroteos-publicos/${P}`)).status).toBe(404);
    expect(db.auth.admin.listUsers).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });
  it('publicar y despublicar retira inmediatamente el acceso público', async () => {
    expect((await own('patch').send({ version: 3, visibilidad: 'publico' })).status).toBe(200);
    expect((await request(app).get(`/api/poroteos-publicos/${P}`)).status).toBe(200);
    expect((await own('patch').send({ version: 4, visibilidad: 'privado' })).status).toBe(200);
    expect((await request(app).get(`/api/poroteos-publicos/${P}`)).status).toBe(404);
  });
  it('colaborador no publica, administra ni elimina; no consulta Auth', async () => {
    expect((await own('patch', url, C).send({ version: 3, visibilidad: 'publico' })).status).toBe(
      403,
    );
    expect((await own('get', `${url}/miembros`, C)).status).toBe(403);
    expect(
      (
        await own('post', `${url}/miembros`, C).send({
          version: 3,
          email: '4@example.org',
          rol: 'dueno',
        })
      ).status,
    ).toBe(403);
    expect(
      (await own('patch', `${url}/miembros/${A}`, C).send({ version: 3, rol: 'colaborador' }))
        .status,
    ).toBe(403);
    expect((await own('delete', `${url}/miembros/${A}`, C).send({ version: 3 })).status).toBe(403);
    expect((await own('delete', url, C).send({ version: 3 })).status).toBe(403);
    expect(db.auth.admin.listUsers).not.toHaveBeenCalled();
  });
  it('agrega por email normalizado; duplicado 409 e inexistente 404', async () => {
    expect(
      (
        await own('post', `${url}/miembros`).send({
          version: 3,
          email: ' 4@EXAMPLE.ORG ',
          rol: 'dueno',
        })
      ).status,
    ).toBe(200);
    expect(miembros.find((m) => m.user_id === D).rol).toBe('dueno');
    expect(
      (
        await own('post', `${url}/miembros`).send({
          version: 4,
          email: '4@example.org',
          rol: 'dueno',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await own('post', `${url}/miembros`).send({
          version: 4,
          email: 'no@example.org',
          rol: 'colaborador',
        })
      ).status,
    ).toBe(404);
    const list = await own('get', `${url}/miembros`);
    expect(list.body.data.miembros[0]).toEqual({ userId: A, email: cuenta(A).email, rol: 'dueno' });
    expect(JSON.stringify(list.body)).not.toContain('auth-interno');
  });
  it('busca cuentas en páginas posteriores de Auth', async () => {
    db.auth.admin.listUsers
      .mockResolvedValueOnce({
        data: {
          users: Array.from({ length: 100 }, (_, i) => ({
            id: `${i}`,
            email: `otro${i}@example.org`,
          })),
          total: 101,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { users: [cuenta(D)], total: 101 }, error: null });
    expect(
      (
        await own('post', `${url}/miembros`).send({
          version: 3,
          email: '4@example.org',
          rol: 'colaborador',
        })
      ).status,
    ).toBe(200);
    expect(db.auth.admin.listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 100 });
  });
  it('cambia roles, protege último dueño al quitar, salir y degradar', async () => {
    expect(
      (await own('patch', `${url}/miembros/${B}`).send({ version: 3, rol: 'colaborador' })).status,
    ).toBe(200);
    const last = await own('post', `${url}/salir`).send({ version: 4 });
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe('LAST_OWNER');
    expect(
      (await own('patch', `${url}/miembros/${A}`).send({ version: 4, rol: 'colaborador' })).status,
    ).toBe(409);
    expect((await own('delete', `${url}/miembros/${A}`).send({ version: 4 })).status).toBe(409);
  });
  it.each([A, C])('salir revoca acceso de %s aunque sea creador', async (actor) => {
    const res = await own('post', `${url}/salir`, actor).send({ version: 3 });
    expect(res.status).toBe(200);
    expect(res.body.data.salido).toBe(true);
    expect((await own('get', url, actor)).status).toBe(404);
  });
  it('quitar revoca acceso; eliminar conserva 204 y limpia hijos', async () => {
    expect((await own('delete', `${url}/miembros/${C}`).send({ version: 3 })).status).toBe(200);
    expect((await own('get', url, C)).status).toBe(404);
    expect((await own('delete').send({ version: 4 })).status).toBe(204);
    expect(votos.every((v) => v.poroteo_id !== P)).toBe(true);
    expect(miembros.every((m) => m.poroteo_id !== P)).toBe(true);
  });
  it('conflicto no sobreescribe ni reintenta', async () => {
    expect((await own('patch').send({ version: 2, titulo: 'Viejo' })).status).toBe(409);
    expect(rows[0].titulo).toBe('Proyecto 0');
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['PT401', 401, 'UNAUTHORIZED'],
    ['PT404', 404, 'NOT_FOUND'],
    ['PT403', 403, 'FORBIDDEN'],
    ['PT409', 409, 'VERSION_CONFLICT'],
    ['PT400', 400, 'BAD_REQUEST'],
    ['23503', 400, 'BAD_REQUEST'],
    ['23505', 409, 'MEMBER_EXISTS'],
    ['23502', 400, 'BAD_REQUEST'],
    ['23514', 400, 'BAD_REQUEST'],
    ['22P02', 400, 'BAD_REQUEST'],
    ['22003', 400, 'BAD_REQUEST'],
  ])('traduce %s sin filtrar errores internos', async (code, status, apiCode) => {
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { code, message: 'Detalle interno privado' },
    });
    const res = await own('patch').send({ version: 3, titulo: 'Cambio válido' });
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(apiCode);
    expect(JSON.stringify(res.body)).not.toContain('Detalle interno privado');
  });
  it('vuelve a validar al dueño después de la búsqueda Auth, bajo bloqueo en RPC', async () => {
    db.auth.admin.listUsers.mockImplementationOnce(async () => {
      miembros.find((m) => m.poroteo_id === P && m.user_id === A).rol = 'colaborador';
      rows[0].version++;
      return { data: { users: [cuenta(D)], total: 1 }, error: null };
    });
    expect(
      (
        await own('post', `${url}/miembros`).send({
          version: 3,
          email: '4@example.org',
          rol: 'dueno',
        })
      ).status,
    ).toBe(409);
    expect(miembros.some((m) => m.user_id === D)).toBe(false);
  });
  it('rechaza snapshot mixto si una mutación ocurre durante la carga de votos', async () => {
    db.from.mockImplementation((table) => {
      if (table === 'poroteo_votos') rows[0].version++;
      return query(table);
    });
    const res = await own('get');
    expect(res.status).toBe(409);
    expect(res.body).not.toHaveProperty('data');
  });
  it('despublicar durante la carga retira también la respuesta en curso', async () => {
    db.from.mockImplementation((table) => {
      if (table === 'poroteo_votos') rows[1].visibilidad = 'privado';
      return query(table);
    });
    expect((await request(app).get(`/api/poroteos-publicos/${Q}`)).status).toBe(404);
  });
  it.each(['merge', 'replace'])(
    'votos %s usan exclusivamente la RPC y adaptan DTO',
    async (modo) => {
      const res = await own('put', `${url}/votos`, C).send({
        version: 3,
        modo,
        votos: [{ diputadoId: 3, voto: 'AFIRMATIVO', origen: 'ia', confianza: 0.8 }],
      });
      expect(res.status).toBe(200);
      expect(db.rpc).toHaveBeenCalledWith(
        'poroteo_mutar',
        expect.objectContaining({
          p_actor_id: C,
          p_accion: 'guardar_votos',
          p_version: 3,
          p_datos: {
            modo,
            votos: [
              {
                diputado_id: 3,
                voto: 'AFIRMATIVO',
                origen: 'ia',
                confianza: 0.8,
                justificacion: null,
                fuentes: null,
              },
            ],
          },
        }),
      );
      expect(calls.every((c) => c.operation === 'select')).toBe(true);
      expect(res.body.data.origen).toBe(modo === 'replace' ? 'ia' : 'mixto');
    },
  );
  it('replace inválido conserva snapshot y revisión; ninguna escritura separada', async () => {
    const snapshot = structuredClone(votos);
    expect(
      (
        await own('put', `${url}/votos`).send({
          version: 3,
          modo: 'replace',
          votos: [{ diputadoId: 999, voto: 'NEGATIVO' }],
        })
      ).status,
    ).toBe(400);
    expect(votos).toEqual(snapshot);
    expect(rows[0].version).toBe(3);
    expect(calls).toEqual([]);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it('creación privada recarga versión del trigger sin insertar dueño duplicado', async () => {
    const res = await own('post', '/api/poroteos').send({ titulo: 'Proyecto creado' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ version: 2, visibilidad: 'privado', rolActual: 'dueno' });
    expect(rows.find((r) => r.id === D).user_id).toBe(A);
    expect(calls.filter((c) => c.operation === 'insert')).toEqual([
      { table: 'poroteos', operation: 'insert' },
    ]);
  });
  it.each(['user_id', 'userId', 'usuario_id', 'actorId', 'p_actor_id', 'rol', 'permisos'])(
    'rechaza manipulación de %s',
    async (key) => {
      expect(
        (await own('post', '/api/poroteos').send({ titulo: 'Proyecto', [key]: D })).status,
      ).toBe(400);
      expect((await own('patch').send({ version: 3, titulo: 'Intrusión', [key]: D })).status).toBe(
        400,
      );
      expect(
        (await own('put', `${url}/votos`).send({ version: 3, votos: [], [key]: D })).status,
      ).toBe(400);
      expect(db.rpc).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '0', 'abc', '9223372036854775808'])(
    'valida versión %s',
    async (version) => {
      expect((await own('patch').send({ version, titulo: 'Proyecto' })).status).toBe(400);
      expect(db.rpc).not.toHaveBeenCalled();
    },
  );
  it.each(['get', 'post', 'patch', 'delete', 'put'])('sin sesión: %s', async (method) => {
    const path = method === 'post' ? '/api/poroteos' : `${url}${method === 'put' ? '/votos' : ''}`;
    expect((await request(app)[method](path)).status).toBe(401);
    expect((await own(method, path, 'invalido')).status).toBe(401);
    expect(calls).toEqual([]);
  });
});
