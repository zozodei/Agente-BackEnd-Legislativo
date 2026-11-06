import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const emails = vi.hoisted(() => []);
vi.mock('../src/config/env.js', async (original) => {
  const actual = await original();
  return { ...actual, env: { ...actual.env, SUPERADMIN_EMAILS: emails } };
});
vi.mock('../src/config/supabaseAuth.js', () => ({ createAuthClient: vi.fn() }));
vi.mock('../src/config/supabase.js', () => ({
  supabase: {},
  supabaseAdmin: { auth: { admin: { listUsers: vi.fn() } } },
}));
vi.mock('../src/services/stats.service.js', () => ({ getResumen: vi.fn() }));
vi.mock('../src/services/poroteos.service.js', () => ({
  listPoroteosGlobal: vi.fn(),
  getPoroteoGlobal: vi.fn(),
}));
vi.mock('../src/repositories/poroteos.repository.js', () => ({ countPoroteos: vi.fn() }));

const { createAuthClient } = await import('../src/config/supabaseAuth.js');
const { supabaseAdmin } = await import('../src/config/supabase.js');
const stats = await import('../src/services/stats.service.js');
const poroteos = await import('../src/services/poroteos.service.js');
const { countPoroteos } = await import('../src/repositories/poroteos.repository.js');
const { resolverRol } = await import('../src/services/roles.service.js');
const { createApp } = await import('../src/app.js');
const app = createApp();
const LISTA = ['augustraver@gmail.com', 'zoe@acquistapace.com.ar', 'lucas.ioel.roitman@gmail.com'];
const UUID = '6f1c2a4e-1b2c-4d3e-8f90-123456789abc';
const endpoints = [
  '/api/admin/resumen',
  '/api/admin/cuentas',
  '/api/admin/poroteos',
  `/api/admin/poroteos/${UUID}`,
];
let getUser;
function identity(email = LISTA[0], confirmado = '2026-11-01T12:00:00Z') {
  return { id: UUID, email, email_confirmed_at: confirmado, user_metadata: { rol: 'superadmin' } };
}
function autorizado(path) {
  return request(app).get(path).set('Authorization', 'Bearer test-access');
}

beforeEach(() => {
  vi.resetAllMocks();
  emails.splice(0, emails.length, ...LISTA);
  getUser = vi.fn().mockResolvedValue({ data: { user: identity() }, error: null });
  createAuthClient.mockReturnValue({ auth: { getUser } });
  stats.getResumen.mockResolvedValue({
    camara: { diputados: 257, bloques: 21 },
    votaciones: { total: 2992 },
  });
  countPoroteos.mockImplementation(async (estado) =>
    estado === 'borrador' ? 3 : estado === 'final' ? 2 : 5,
  );
  poroteos.listPoroteosGlobal.mockResolvedValue({
    data: [],
    meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  });
  poroteos.getPoroteoGlobal.mockResolvedValue({ id: UUID, titulo: 'Proyecto', votos: [] });
  supabaseAdmin.auth.admin.listUsers.mockResolvedValue({
    data: { users: [], total: 0 },
    error: null,
  });
});

describe('Guard en todo /api/admin', () => {
  it.each(endpoints)('sin token devuelve 401: %s', async (path) => {
    expect((await request(app).get(path)).status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
    expect(supabaseAdmin.auth.admin.listUsers).not.toHaveBeenCalled();
  });
  it.each(['bad_jwt', 'session_expired'])(
    'token inválido/vencido %s devuelve 401',
    async (code) => {
      getUser.mockResolvedValue({ error: { code, status: 401 } });
      for (const path of endpoints) expect((await autorizado(path)).status).toBe(401);
      expect(countPoroteos).not.toHaveBeenCalled();
    },
  );
  it.each(endpoints)('usuario normal devuelve 403: %s', async (path) => {
    getUser.mockResolvedValue({ data: { user: identity('normal@example.org') } });
    const res = await autorizado(path);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(countPoroteos).not.toHaveBeenCalled();
    expect(poroteos.listPoroteosGlobal).not.toHaveBeenCalled();
    expect(poroteos.getPoroteoGlobal).not.toHaveBeenCalled();
    expect(supabaseAdmin.auth.admin.listUsers).not.toHaveBeenCalled();
  });
  it.each(LISTA)('email permitido y confirmado accede a todo: %s', async (email) => {
    getUser.mockResolvedValue({ data: { user: identity(email) } });
    for (const path of endpoints) {
      const res = await autorizado(path);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect(getUser).toHaveBeenCalledTimes(4);
    expect(getUser).toHaveBeenCalledWith('test-access');
  });
  it('email permitido sin confirmar no accede ni usando confirmed_at de teléfono', async () => {
    getUser.mockResolvedValue({
      data: {
        user: {
          ...identity(LISTA[0], null),
          confirmed_at: '2026-11-01',
          phone_confirmed_at: '2026-11-01',
        },
      },
    });
    expect((await autorizado('/api/admin/cuentas')).status).toBe(403);
  });
  it('normaliza espacios/mayúsculas en identidad y configuración', async () => {
    emails.splice(0, emails.length, ` ${LISTA[0].toUpperCase()} `);
    getUser.mockResolvedValue({ data: { user: identity(` ${LISTA[0].toUpperCase()} `) } });
    expect((await autorizado('/api/admin/cuentas')).status).toBe(200);
  });
  it.each(['prefijoaugustraver@gmail.com', 'augustraver@gmail.com.evil.org', 'otra@example.org'])(
    'no permite coincidencias parciales/otros emails: %s',
    async (email) => {
      emails.push(email);
      getUser.mockResolvedValue({ data: { user: identity(email) } });
      expect((await autorizado('/api/admin/cuentas')).status).toBe(403);
    },
  );
  it('lista vacía deniega incluso si metadata afirma ser admin', async () => {
    emails.splice(0);
    expect((await autorizado('/api/admin/cuentas')).status).toBe(403);
  });
  it.each(LISTA)('/auth/me expone el rol efectivo del email actual: %s', async (email) => {
    getUser.mockResolvedValue({ data: { user: identity(email) } });
    expect((await autorizado('/api/auth/me')).body.data.rol).toBe('superadmin');
    emails.splice(0);
    expect((await autorizado('/api/auth/me')).body.data.rol).toBe('usuario');
  });
  it('ni el role de Postgres ni el email de metadata conceden acceso', async () => {
    getUser.mockResolvedValue({
      data: {
        user: {
          ...identity('normal@example.org'),
          role: 'superadmin',
          user_metadata: { rol: 'superadmin', email: LISTA[0] },
        },
      },
    });
    expect((await autorizado('/api/admin/cuentas')).status).toBe(403);
  });
  it('cambiar email retira acceso con el mismo token; consulta la identidad otra vez', async () => {
    expect((await autorizado('/api/admin/cuentas')).status).toBe(200);
    getUser.mockResolvedValue({ data: { user: identity('nuevo@example.org') } });
    expect((await autorizado('/api/admin/cuentas')).status).toBe(403);
    expect(getUser).toHaveBeenCalledTimes(2);
  });
  it('quitar el email de configuración retira acceso sin guardar roles en Auth', async () => {
    expect((await autorizado('/api/admin/cuentas')).status).toBe(200);
    emails.splice(0);
    expect((await autorizado('/api/admin/cuentas')).status).toBe(403);
    expect(getUser).toHaveBeenCalledTimes(2);
  });
  it('body/query/header personalizados no conceden permisos', async () => {
    getUser.mockResolvedValue({ data: { user: identity('normal@example.org') } });
    const res = await autorizado('/api/admin/cuentas')
      .query({ email: LISTA[0], rol: 'superadmin' })
      .set('X-Email', LISTA[0])
      .set('X-Role', 'superadmin')
      .send({ email: LISTA[0], rol: 'superadmin' });
    expect(res.status).toBe(403);
  });
  it('toda ruta futura/método no soportado también pasa por los guards', async () => {
    expect((await request(app).post('/api/admin/cuentas')).status).toBe(401);
    expect((await request(app).get('/api/admin/futura')).status).toBe(401);
    expect(
      (await request(app).delete('/api/admin/cuentas/1').set('Authorization', 'Bearer test-access'))
        .status,
    ).toBe(404);
    expect(supabaseAdmin.auth.admin.listUsers).not.toHaveBeenCalled();
  });
  it('fallo de Auth deniega sin reutilizar identidad guardada', async () => {
    getUser.mockRejectedValue(new Error('fallo TLS'));
    expect((await autorizado('/api/admin/resumen')).status).toBe(502);
    expect(countPoroteos).not.toHaveBeenCalled();
  });
});

describe('Consultas administrativas', () => {
  it('cuentas paginadas: solo cinco campos permitidos, rol calculado en servidor', async () => {
    supabaseAdmin.auth.admin.listUsers.mockResolvedValue({
      data: {
        total: 41,
        users: [
          {
            ...identity(),
            created_at: '2026-11-01',
            last_sign_in_at: '2026-11-06',
            encrypted_password: 'secreto',
            identities: ['privado'],
            refresh_token: 'privado',
            app_metadata: { role: 'admin' },
          },
          { ...identity(LISTA[1], null), user_metadata: { rol: 'superadmin' } },
        ],
      },
      error: null,
    });
    const res = await autorizado('/api/admin/cuentas?page=2&pageSize=20');
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 2, pageSize: 20, total: 41, totalPages: 3 });
    expect(res.body.data).toEqual([
      {
        id: UUID,
        email: LISTA[0],
        createdAt: '2026-11-01',
        lastSignInAt: '2026-11-06',
        rol: 'superadmin',
      },
      { id: UUID, email: LISTA[1], createdAt: null, lastSignInAt: null, rol: 'usuario' },
    ]);
    expect(supabaseAdmin.auth.admin.listUsers).toHaveBeenCalledWith({ page: 2, perPage: 20 });
    expect(JSON.stringify(res.body)).not.toMatch(/secreto|privado|metadata|token|password/);
  });
  it.each(['page=0', 'pageSize=101', 'page=abc'])('valida paginación: %s', async (query) => {
    expect((await autorizado(`/api/admin/cuentas?${query}`)).status).toBe(400);
    expect(supabaseAdmin.auth.admin.listUsers).not.toHaveBeenCalled();
  });
  it('proveedor de cuentas fallido no devuelve lista vacía', async () => {
    supabaseAdmin.auth.admin.listUsers.mockResolvedValue({
      error: { status: 401, message: 'clave privada' },
    });
    const res = await autorizado('/api/admin/cuentas');
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('clave privada');
  });
  it('resume solamente conteos de los servicios/repositories', async () => {
    const res = await autorizado('/api/admin/resumen');
    expect(res.body).toEqual({
      data: {
        poroteos: { total: 5, borradores: 3, finalizados: 2 },
        diputados: 257,
        bloques: 21,
        votaciones: 2992,
      },
    });
  });
  it('listado y detalle usan los servicios actuales sin escribir', async () => {
    await autorizado('/api/admin/poroteos?q=ley&page=2');
    expect(poroteos.listPoroteosGlobal).toHaveBeenCalledWith({ q: 'ley', page: 2, pageSize: 20 });
    const res = await autorizado(`/api/admin/poroteos/${UUID}`);
    expect(poroteos.getPoroteoGlobal).toHaveBeenCalledWith(UUID);
    expect(res.body.data.titulo).toBe('Proyecto');
  });
  it('roles no alteran el role de PostgreSQL ni persisten metadata', () => {
    const original = { ...identity(), role: 'authenticated' };
    const copy = structuredClone(original);
    expect(resolverRol(original)).toBe('superadmin');
    expect(original).toEqual(copy);
    expect(resolverRol(original, [])).toBe('usuario');
  });
});
