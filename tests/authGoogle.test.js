import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Flujo Google con PKCE: Supabase Auth se reemplaza por un fetch doble, nunca red.
vi.mock('../src/config/supabaseAuth.js', () => ({ createAuthClient: vi.fn() }));

const { createApp } = await import('../src/app.js');
const app = createApp();
const FRONT = 'http://localhost:5173';
const CALLBACK = `${FRONT}/auth/callback`;
const user = {
  id: '6f1c2a4e-1b2c-4d3e-8f90-123456789abc',
  email: 'ana@example.org',
  email_confirmed_at: '2026-11-06T12:00:00Z',
  user_metadata: { nombre: 'Ana' },
  created_at: '2026-11-06T12:00:00Z',
};
const tokenPayload = {
  access_token: 'access-google',
  refresh_token: 'refresh-google',
  expires_in: 3600,
  expires_at: 1900000000,
  token_type: 'bearer',
  user,
};

let fetchMock;
let ipIndex = 1;
let ip;
const json = (status, body) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );

const iniciar = (redirectTo = CALLBACK) =>
  request(app)
    .get('/api/auth/google')
    .query({ redirectTo })
    .set('X-Forwarded-For', ip)
    .set('X-Session-Mode', 'cookie');

const pkceDe = (res) => {
  const cookie = res.headers['set-cookie'].find((c) => c.startsWith('poroteo_pkce='));
  return {
    cookie: cookie.split(';')[0],
    verifier: decodeURIComponent(cookie.split(';')[0].slice(13)),
  };
};

const completar = (cookie, code = 'codigo-google') => {
  const req = request(app)
    .post('/api/auth/google/callback')
    .set('X-Forwarded-For', ip)
    .set('Origin', FRONT)
    .set('X-Session-Mode', 'cookie');
  if (cookie) req.set('Cookie', cookie);
  return req.send({ code });
};

beforeEach(() => {
  ip = `198.51.100.${ipIndex++}`;
  fetchMock = vi.fn((url) =>
    String(url).endsWith('/settings')
      ? json(200, { external: { google: true } })
      : json(200, tokenPayload),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/auth/google', () => {
  it('devuelve la URL de Supabase con challenge S256 y guarda el verifier en cookie HttpOnly', async () => {
    const res = await iniciar();
    expect(res.status).toBe(200);
    const url = new URL(res.body.data.url);
    expect(url.origin + url.pathname).toBe('https://test-project.supabase.co/auth/v1/authorize');
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('redirect_to')).toBe(CALLBACK);
    expect(url.searchParams.get('code_challenge_method')).toBe('s256');

    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('poroteo_pkce='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/api\/auth\/google/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const { verifier } = pkceDe(res);
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(verifier).digest('base64url'),
    );
    // El verifier nunca viaja en el cuerpo.
    expect(JSON.stringify(res.body)).not.toContain(verifier);
  });

  it.each([
    'https://malicioso.example/auth/callback',
    `${FRONT}/otra-ruta`,
    `${FRONT}/auth/callback?next=https://malicioso.example`,
    'no-es-una-url',
  ])('rechaza redirectTo no permitido: %s', async (redirectTo) => {
    const res = await iniciar(redirectTo);
    expect(res.status).toBe(400);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('informa 503 si Google no está habilitado en Supabase', async () => {
    fetchMock.mockImplementation(() => json(200, { external: { google: false } }));
    const res = await iniciar();
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('GOOGLE_DISABLED');
  });
});

describe('POST /api/auth/google/callback', () => {
  it('canjea el código con el verifier de la cookie y abre la sesión con cookies', async () => {
    const { cookie, verifier } = pkceDe(await iniciar());
    const res = await completar(cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.usuario).toMatchObject({ id: user.id, email: user.email, rol: 'usuario' });
    expect(res.body.data.sesion).toEqual({
      expiresIn: 3600,
      expiresAt: 1900000000,
      tokenType: 'bearer',
    });
    expect(JSON.stringify(res.body)).not.toContain('access-google');

    const [url, init] = fetchMock.mock.calls.at(-1);
    expect(String(url)).toBe('https://test-project.supabase.co/auth/v1/token?grant_type=pkce');
    expect(JSON.parse(init.body)).toEqual({ auth_code: 'codigo-google', code_verifier: verifier });

    const cookies = res.headers['set-cookie'].join('\n');
    expect(cookies).toMatch(/poroteo_access=access-google/);
    expect(cookies).toMatch(/poroteo_refresh=refresh-google/);
    expect(cookies).toMatch(/poroteo_pkce=;/); // se borra: un solo intento
  });

  it('sin la cookie del verifier no llama a Supabase', async () => {
    const res = await completar(null);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OAUTH_FAILED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('código vencido o ajeno devuelve OAUTH_FAILED', async () => {
    const { cookie } = pkceDe(await iniciar());
    fetchMock.mockImplementation(() => json(400, { error_code: 'flow_state_not_found' }));
    const res = await completar(cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OAUTH_FAILED');
  });

  it('exige Origin permitido (CSRF)', async () => {
    const { cookie } = pkceDe(await iniciar());
    const res = await request(app)
      .post('/api/auth/google/callback')
      .set('X-Forwarded-For', ip)
      .set('Origin', 'https://malicioso.example')
      .set('X-Session-Mode', 'cookie')
      .set('Cookie', cookie)
      .send({ code: 'codigo-google' });
    expect(res.status).toBe(403);
  });
});
