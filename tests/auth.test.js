import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifiedClaims } from './claims.fixture.js';

// Prueba todo el flujo HTTP → repository, sin llamadas al proyecto real.
vi.mock('../src/config/supabaseAuth.js', () => ({ createAuthClient: vi.fn() }));

const { createAuthClient } = await import('../src/config/supabaseAuth.js');
const { createApp } = await import('../src/app.js');
const { logger } = await import('../src/config/logger.js');
const app = createApp();
const user = {
  id: '6f1c2a4e-1b2c-4d3e-8f90-123456789abc',
  email: 'ana@example.org',
  user_metadata: { nombre: 'Ana', rol: 'admin', extra: 'No exponer' },
  app_metadata: { provider: 'email' },
  created_at: '2026-11-06T12:00:00Z',
};
const session = {
  access_token: 'access-test',
  refresh_token: 'refresh-test',
  expires_in: 3600,
  expires_at: 1900000000,
  token_type: 'bearer',
  user,
};
const usuario = {
  id: user.id,
  email: user.email,
  nombre: 'Ana',
  rol: 'usuario',
  createdAt: user.created_at,
};
const sesion = {
  accessToken: 'access-test',
  refreshToken: 'refresh-test',
  expiresIn: 3600,
  expiresAt: 1900000000,
  tokenType: 'bearer',
};
const credentials = { email: 'ana@example.org', password: ' clave123 ' };
let auth;
let ipIndex = 1;
let ip;
const post = (path) => request(app).post(`/api/auth/${path}`).set('X-Forwarded-For', ip);

beforeEach(() => {
  vi.resetAllMocks();
  ip = `192.0.2.${ipIndex++}`;
  auth = {
    getClaims: vi.fn().mockResolvedValue(verifiedClaims(user.id)),
    signUp: vi.fn().mockResolvedValue({ data: { user, session: null }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user, session }, error: null }),
    refreshSession: vi.fn().mockResolvedValue({ data: { user, session }, error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    admin: { signOut: vi.fn().mockResolvedValue({ data: null, error: null }) },
  };
  createAuthClient.mockReturnValue({ auth });
});

describe('Registro e inicio de sesión', () => {
  it('registra nombre/email/password y admite confirmación por correo', async () => {
    const res = await post('registro').send({
      nombre: ' Ana ',
      email: ' ANA@example.org ',
      password: credentials.password,
      rol: 'admin',
    });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ data: { usuario, sesion: null, requiereConfirmacion: true } });
    expect(auth.signUp).toHaveBeenCalledWith({
      ...credentials,
      options: { data: { nombre: 'Ana' }, emailRedirectTo: 'http://localhost:5173/login' },
    });
  });

  it('registro entrega sesión si el proyecto no requiere confirmación', async () => {
    auth.signUp.mockResolvedValue({ data: { user, session }, error: null });
    const res = await post('registro').send({ ...credentials, nombre: 'Ana' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: { usuario, sesion, requiereConfirmacion: false } });
  });

  it('no infiere un conflicto de una respuesta ofuscada sin sesión', async () => {
    auth.signUp.mockResolvedValue({
      data: { user: { ...user, identities: [] }, session: null },
      error: null,
    });
    const res = await post('registro').send({ ...credentials, nombre: 'Ana' });
    expect(res.status).toBe(201);
    expect(res.body.data.requiereConfirmacion).toBe(true);
    expect(auth.signUp).toHaveBeenCalledTimes(1);
  });

  it('login conserva el contrato camelCase y no devuelve metadatos adicionales', async () => {
    const res = await post('login').send(credentials);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { usuario, sesion } });
    expect(auth.signInWithPassword).toHaveBeenCalledWith(credentials);
    expect(res.body.data.usuario.rol).toBe('usuario');
    expect(res.body.data.usuario.app_metadata).toBeUndefined();
  });

  it.each([
    ['registro', { ...credentials, nombre: 'A' }, 'nombre'],
    ['registro', { ...credentials, nombre: 'Ana', password: 'corta' }, 'password'],
    ['registro', { ...credentials, nombre: 'Ana', password: 'x'.repeat(73) }, 'password'],
    ['registro', { ...credentials, nombre: 'Ana', email: 'sin-email' }, 'email'],
    ['login', { ...credentials, password: '' }, 'password'],
    ['login', { ...credentials, email: null }, 'email'],
    ['refresh', { refreshToken: '' }, 'refreshToken'],
  ])('%s valida el campo %s antes de llamar al proveedor', async (path, body, campo) => {
    const res = await post(path).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.details).toContainEqual({
      campo: `body.${campo}`,
      mensaje: expect.any(String),
    });
    expect(createAuthClient).not.toHaveBeenCalled();
  });

  it('no convierte una respuesta incompleta del proveedor en login exitoso', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user, session: null }, error: null });
    const res = await post('login').send(credentials);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('UPSTREAM_ERROR');
  });

  it('limita intentos de login por IP, sin llamar al proveedor una vez bloqueado', async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: { code: 'invalid_credentials', status: 400 },
    });
    for (let i = 0; i < 20; i++) expect((await post('login').send(credentials)).status).toBe(401);
    const res = await post('login').send(credentials);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.headers.ratelimit).toBeDefined();
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(20);
  });
});

describe('Sesiones', () => {
  it('refresh entrega los tokens nuevos sin usar el Bearer viejo', async () => {
    const res = await post('refresh')
      .set('Authorization', 'Bearer vencido')
      .send({ refreshToken: 'refresh-anterior' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { usuario, sesion } });
    expect(auth.refreshSession).toHaveBeenCalledWith({ refresh_token: 'refresh-anterior' });
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it('me verifica el JWT con el proveedor y devuelve solo el perfil', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'bearer token-user');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { id: user.id, email: user.email, nombre: 'Ana', rol: 'usuario' },
    });
    expect(auth.getUser).toHaveBeenCalledWith('token-user');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([undefined, '', 'Basic token', 'Bearer', 'Bearer uno dos'])(
    'rechaza Authorization inválido: %s',
    async (header) => {
      let req = request(app).get('/api/auth/me');
      if (header !== undefined) req = req.set('Authorization', header);
      const res = await req;
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(createAuthClient).not.toHaveBeenCalled();
    },
  );

  it('logout revoca solo la sesión indicada y responde 204', async () => {
    const res = await post('logout').set('Authorization', 'Bearer token-user');
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(auth.admin.signOut).toHaveBeenCalledWith('token-user', 'local');
  });

  it('logout sin Bearer no intenta revocar una sesión compartida', async () => {
    expect((await post('logout')).status).toBe(401);
    expect(createAuthClient).not.toHaveBeenCalled();
  });

  it('solicitudes concurrentes no comparten el cliente de autenticación', async () => {
    const clientes = [];
    createAuthClient.mockImplementation(() => {
      const cliente = {
        auth: {
          signInWithPassword: vi.fn(async ({ email }) => ({
            data: {
              user: { ...user, id: email, email },
              session: { ...session, access_token: email },
            },
            error: null,
          })),
        },
      };
      clientes.push(cliente);
      return cliente;
    });
    const [a, b] = await Promise.all([
      post('login').send({ ...credentials, email: 'uno@example.org' }),
      post('login').send({ ...credentials, email: 'dos@example.org' }),
    ]);
    expect(a.body.data.usuario.id).toBe('uno@example.org');
    expect(a.body.data.sesion.accessToken).toBe('uno@example.org');
    expect(b.body.data.usuario.id).toBe('dos@example.org');
    expect(b.body.data.sesion.accessToken).toBe('dos@example.org');
    expect(clientes).toHaveLength(2);
    expect(clientes[0]).not.toBe(clientes[1]);
  });
});

describe('Traducción de errores Auth', () => {
  it.each([
    ['login', 'signInWithPassword', 'invalid_credentials', 400, 401, 'INVALID_CREDENTIALS'],
    ['login', 'signInWithPassword', 'email_not_confirmed', 400, 403, 'EMAIL_NOT_CONFIRMED'],
    ['registro', 'signUp', 'user_already_exists', 422, 409, 'CONFLICT'],
    ['registro', 'signUp', 'signup_disabled', 422, 403, 'FORBIDDEN'],
    ['registro', 'signUp', 'email_address_not_authorized', 403, 403, 'FORBIDDEN'],
    ['login', 'signInWithPassword', 'invalid_api_key', 401, 502, 'UPSTREAM_ERROR'],
    ['registro', 'signUp', 'weak_password', 422, 400, 'BAD_REQUEST'],
    ['registro', 'signUp', 'over_email_send_rate_limit', 429, 429, 'RATE_LIMITED'],
    ['registro', 'signUp', 'unexpected_failure', 500, 502, 'UPSTREAM_ERROR'],
    ['refresh', 'refreshSession', 'refresh_token_already_used', 400, 401, 'SESSION_EXPIRED'],
    ['refresh', 'refreshSession', 'refresh_token_not_found', 400, 401, 'SESSION_EXPIRED'],
  ])(
    '%s: %s/%s conserva el código para el frontend',
    async (path, method, code, status, expected, apiCode) => {
      auth[method].mockResolvedValue({
        data: null,
        error: { code, status, message: 'secreto-no-exponer' },
      });
      const res = await post(path).send(
        path === 'refresh' ? { refreshToken: 'secret' } : { ...credentials, nombre: 'Ana' },
      );
      expect(res.status).toBe(expected);
      expect(res.body.error.code).toBe(apiCode);
      expect(JSON.stringify(res.body)).not.toContain('secreto-no-exponer');
    },
  );

  it('token falsificado o vencido en me devuelve 401', async () => {
    auth.getUser.mockResolvedValue({ error: { code: 'bad_jwt', status: 401 } });
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer invalid');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('fallo TLS no se confunde con credenciales inválidas ni expone secretos en logs', async () => {
    const warn = vi.spyOn(logger, 'warn');
    auth.signInWithPassword.mockRejectedValue(new Error('SELF_SIGNED_CERT_IN_CHAIN token-secreto'));
    const res = await post('login').send(credentials);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('UPSTREAM_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('token-secreto');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('token-secreto');
    warn.mockRestore();
  });
});
