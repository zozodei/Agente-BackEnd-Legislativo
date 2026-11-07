import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/config/supabaseAuth.js', () => ({ createAuthClient: vi.fn() }));
const { createAuthClient } = await import('../src/config/supabaseAuth.js');
const { createApp } = await import('../src/app.js');
const app = createApp();
const renewed = {
  access_token: 'access-renovado-sesion-a',
  refresh_token: 'refresh-rotado-sesion-a',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
};
let auth;
const logout = () =>
  request(app)
    .post('/api/auth/logout')
    .set('Origin', 'http://localhost:5173')
    .set('X-Session-Mode', 'cookie');

function expectCleared(res) {
  const cookies = res.headers['set-cookie'];
  expect(cookies).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^poroteo_access=;.*Path=\/api;.*Expires=Thu, 01 Jan 1970/),
      expect.stringMatching(/^poroteo_refresh=;.*Path=\/api\/auth;.*Expires=Thu, 01 Jan 1970/),
    ]),
  );
  expect(cookies.every((cookie) => cookie.includes('Expires=Thu, 01 Jan 1970'))).toBe(true);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(JSON.stringify(res.body)).not.toMatch(/access-renovado|refresh-rotado|secreto-proveedor/);
}

beforeEach(() => {
  auth = {
    refreshSession: vi.fn().mockResolvedValue({ data: { session: renewed }, error: null }),
    admin: { signOut: vi.fn().mockResolvedValue({ data: null, error: null }) },
    getClaims: vi.fn(),
    getUser: vi.fn(),
  };
  createAuthClient.mockReset().mockReturnValue({ auth });
});

it.each([undefined, 'access-vencido', 'jwt.falsificado.no-confiable', 'access%20malformado'])(
  'logout con refresh y access %s renueva y revoca solo la sesión del refresh',
  async (access) => {
    const cookie = ['poroteo_refresh=refresh-sesion-a', access && `poroteo_access=${access}`]
      .filter(Boolean)
      .join('; ');
    const res = await logout()
      .set('Cookie', cookie)
      .set('Authorization', 'Bearer access-otra-cuenta')
      .send({
        accessToken: 'access-otra-cuenta',
        refreshToken: 'refresh-otra-cuenta',
        user_id: 'otra-cuenta',
      });
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(auth.refreshSession).toHaveBeenCalledExactlyOnceWith({
      refresh_token: 'refresh-sesion-a',
    });
    expect(auth.admin.signOut).toHaveBeenCalledExactlyOnceWith(renewed.access_token, 'local');
    expect(auth.getClaims).not.toHaveBeenCalled();
    expect(auth.getUser).not.toHaveBeenCalled();
    expect(auth.refreshSession.mock.invocationCallOrder[0]).toBeLessThan(
      auth.admin.signOut.mock.invocationCallOrder[0],
    );
    expectCleared(res);
  },
);

it.each([
  [{ code: 'refresh_token_not_found', status: 400 }, 401],
  [{ code: 'refresh_token_already_used', status: 400 }, 401],
  [{ code: 'unexpected_failure', status: 503 }, 502],
  [{ code: 'over_request_rate_limit', status: 429 }, 429],
])(
  'refresh rechazado (%j) borra cookies sin intentar cerrar otra sesión',
  async (error, status) => {
    auth.refreshSession.mockResolvedValue({ error: { ...error, message: 'secreto-proveedor' } });
    const res = await logout().set(
      'Cookie',
      'poroteo_refresh=refresh-invalido; poroteo_access=access-otra-cuenta',
    );
    expect(res.status).toBe(status);
    expect(auth.admin.signOut).not.toHaveBeenCalled();
    expectCleared(res);
  },
);

it.each(['refresh', 'signOut'])(
  'fallo de red en %s borra cookies pero informa revocación no confirmada',
  async (step) => {
    const operation = step === 'refresh' ? auth.refreshSession : auth.admin.signOut;
    operation.mockRejectedValue(new Error('secreto-proveedor'));
    const res = await logout().set('Cookie', 'poroteo_refresh=refresh-sesion-a');
    expect(res.status).toBe(502);
    if (step === 'refresh') expect(auth.admin.signOut).not.toHaveBeenCalled();
    expectCleared(res);
  },
);

it('respuesta incompleta del refresh no revoca ningún token alternativo', async () => {
  auth.refreshSession.mockResolvedValue({ data: { session: null }, error: null });
  const res = await logout().set('Cookie', 'poroteo_refresh=refresh-sesion-a; poroteo_access=otro');
  expect(res.status).toBe(502);
  expect(auth.admin.signOut).not.toHaveBeenCalled();
  expectCleared(res);
});

it('sin cookies el logout cookie es idempotente y no usa el Bearer ajeno', async () => {
  const res = await logout()
    .set('Authorization', 'Bearer otra-cuenta')
    .send({ refreshToken: 'ajeno' });
  expect(res.status).toBe(204);
  expect(createAuthClient).not.toHaveBeenCalled();
  expectCleared(res);
});

it('solo access mantiene signOut local y borra las cookies incluso al estar vencido', async () => {
  auth.admin.signOut.mockResolvedValue({ error: { code: 'bad_jwt', status: 401 } });
  const res = await logout().set('Cookie', 'poroteo_access=access-vencido');
  expect(res.status).toBe(401);
  expect(auth.refreshSession).not.toHaveBeenCalled();
  expect(auth.admin.signOut).toHaveBeenCalledExactlyOnceWith('access-vencido', 'local');
  expectCleared(res);
});

it('cookie de refresh inválida no supera validación ni bloquea el borrado', async () => {
  const res = await logout().set('Cookie', `poroteo_refresh=${'r'.repeat(8193)}`);
  expect(res.status).toBe(401);
  expect(createAuthClient).not.toHaveBeenCalled();
  expectCleared(res);
});

it('CSRF impide renovar o revocar ante un origen ajeno', async () => {
  const res = await logout()
    .set('Origin', 'https://evil.example')
    .set('Cookie', 'poroteo_refresh=refresh-sesion-a');
  expect(res.status).toBe(403);
  expect(createAuthClient).not.toHaveBeenCalled();
});
