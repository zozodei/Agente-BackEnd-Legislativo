import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/supabaseAuth.js', () => ({ createAuthClient: vi.fn() }));
vi.mock('../src/config/env.js', async (original) => {
  const actual = await original();
  return { ...actual, env: { ...actual.env, SUPERADMIN_EMAILS: ['zoe@acquistapace.com.ar'] } };
});
vi.mock('../src/config/supabase.js', () => ({
  supabase: { from: vi.fn() },
  supabaseAdmin: { from: vi.fn() },
}));
const { createAuthClient } = await import('../src/config/supabaseAuth.js');
const { supabase, supabaseAdmin } = await import('../src/config/supabase.js');
const { createApp } = await import('../src/app.js');
const app = createApp();
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ids = [A, B, '33333333-3333-4333-8333-333333333333'];
let rows;
let calls;

// Doble relacional que ejecuta filtros y cuenta antes de paginar. Ninguna red.
function query(table) {
  const filters = [];
  let operation = 'select';
  let payload;
  let single = false;
  let range;
  const q = {
    select: () => q,
    eq: (key, value) => {
      filters.push((row) => row[key] === value);
      return q;
    },
    in: (key, values) => {
      filters.push((row) => values.includes(row[key]));
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
      operation = 'insert';
      payload = data;
      return q;
    },
    update: (data) => {
      operation = 'update';
      payload = data;
      return q;
    },
    delete: () => {
      operation = 'delete';
      return q;
    },
    then: (resolve, reject) =>
      Promise.resolve()
        .then(() => {
          calls.push({ table, operation });
          let data = table === 'poroteos' ? rows.filter((row) => filters.every((f) => f(row))) : [];
          if (operation === 'insert') {
            const row = { ...rows[0], ...payload, id: '44444444-4444-4444-8444-444444444444' };
            rows.push(row);
            data = [row];
          }
          if (operation === 'update') data.forEach((row) => Object.assign(row, payload));
          if (operation === 'delete') rows = rows.filter((row) => !data.includes(row));
          const count = data.length;
          if (range) data = data.slice(range[0], range[1] + 1);
          return { data: single ? (data[0] ?? null) : data, count, error: null };
        })
        .then(resolve, reject),
  };
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  rows = [A, B, null].map((user_id, i) => ({
    id: ids[i],
    user_id,
    titulo: `Proyecto ${i}`,
    autor: 'Descriptivo',
    tipo_mayoria: 'simple',
    camara: 'diputados',
    estado: 'borrador',
    origen: 'manual',
  }));
  createAuthClient.mockReturnValue({
    auth: {
      getUser: vi.fn(async (token) => ({
        data: {
          user: [A, B].includes(token)
            ? {
                id: token,
                email: token === A ? 'zoe@acquistapace.com.ar' : 'normal@example.org',
                email_confirmed_at: '2026-11-01T00:00:00Z',
              }
            : null,
        },
        error: null,
      })),
    },
  });
  supabaseAdmin.from.mockImplementation(query);
});

const own = (method, path, user) =>
  request(app)[method](path).set('Authorization', `Bearer ${user}`);

describe('Poroteos privados con dos identidades verificadas', () => {
  it('solo el backoffice de superadmin consulta todos, incluidos los anteriores', async () => {
    const res = await own('get', '/api/admin/poroteos', A);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(3);
    expect(res.body.data.map((p) => p.id)).toEqual(ids);
    expect((await own('get', `/api/admin/poroteos/${ids[2]}`, A)).status).toBe(200);
    expect((await own('get', '/api/admin/poroteos', B)).status).toBe(403);
    expect((await own('delete', `/api/admin/poroteos/${B}`, A)).status).toBe(404);
    expect(rows).toHaveLength(3);
  });
  it.each([A, B])('lista y cuenta solo los propios: %s', async (user) => {
    const res = await own('get', '/api/poroteos?pageSize=1', user);
    expect(res.status).toBe(200);
    expect(res.body.data.map((p) => p.id)).toEqual([user]);
    expect(res.body.meta).toMatchObject({ total: 1, totalPages: 1 });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([A, B])('consulta el propio, rechaza ajenos y anteriores: %s', async (user) => {
    expect((await own('get', `/api/poroteos/${user}`, user)).status).toBe(200);
    for (const id of ids.filter((id) => id !== user)) {
      calls = [];
      expect((await own('get', `/api/poroteos/${id}`, user)).status).toBe(404);
      expect(calls.some((c) => c.table === 'poroteo_votos')).toBe(false);
    }
  });

  it.each([A, B])('no modifica ni borra poroteos ajenos, incluyendo votos: %s', async (user) => {
    const other = user === A ? B : A;
    for (const id of [other, ids[2]]) {
      expect(
        (await own('patch', `/api/poroteos/${id}`, user).send({ titulo: 'Intrusión' })).status,
      ).toBe(404);
      expect((await own('delete', `/api/poroteos/${id}`, user)).status).toBe(404);
      for (const modo of ['merge', 'replace']) {
        expect(
          (await own('put', `/api/poroteos/${id}/votos`, user).send({ modo, votos: [] })).status,
        ).toBe(404);
      }
    }
    expect(rows).toHaveLength(3);
    expect(rows.find((p) => p.id === other).titulo).toBe(other === A ? 'Proyecto 0' : 'Proyecto 1');
    expect(calls.some((c) => c.table === 'poroteo_votos')).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('crea con el dueño autenticado y autor no concede propiedad', async () => {
    const res = await own('post', '/api/poroteos', A).send({ titulo: 'Mi proyecto', autor: B });
    expect(res.status).toBe(201);
    const row = rows.find((p) => p.id === res.body.data.id);
    expect(row).toMatchObject({ user_id: A, autor: B });
    expect((await own('get', `/api/poroteos/${row.id}`, B)).status).toBe(404);
    expect(
      (await own('patch', `/api/poroteos/${row.id}`, A).send({ autor: 'Otro autor' })).status,
    ).toBe(200);
    expect(row.user_id).toBe(A);
    expect((await own('delete', `/api/poroteos/${row.id}`, A)).status).toBe(204);
  });

  it.each(['user_id', 'userId', 'usuario_id'])(
    'rechaza propietario enviado como %s',
    async (field) => {
      expect(
        (await own('post', '/api/poroteos', A).send({ titulo: 'Proyecto', [field]: B })).status,
      ).toBe(400);
      expect(
        (await own('patch', `/api/poroteos/${A}`, A).send({ titulo: 'Cambio', [field]: B })).status,
      ).toBe(400);
      expect(rows[0].user_id).toBe(A);
      expect(calls).toEqual([]);
    },
  );

  it.each(['get', 'post', 'patch', 'delete', 'put'])(
    'sin sesión o con token inválido: %s',
    async (method) => {
      const path =
        method === 'post'
          ? '/api/poroteos'
          : `/api/poroteos/${A}${method === 'put' ? '/votos' : ''}`;
      expect((await request(app)[method](path)).status).toBe(401);
      expect((await own(method, path, 'invalido')).status).toBe(401);
      expect(calls).toEqual([]);
    },
  );
});
