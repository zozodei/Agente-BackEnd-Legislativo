import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Servicio real de OAuth; solo se dobla fetch (nada sale a la red).
const { createApp } = await import('../src/app.js');
const { iniciarGoogle, limpiarCacheOAuth } = await import('../src/services/oauth.service.js');

const app = createApp();
const VERIFIER = 'a'.repeat(64);

const sesionSupabase = {
  access_token: 'access-google',
  refresh_token: 'refresh-google',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 1_900_000_000,
  user: {
    id: '11111111-2222-4333-8444-555555555555',
    email: 'ana@gmail.com',
    user_metadata: { full_name: 'Ana Gómez', avatar_url: 'https://x/y.png' },
    created_at: '2026-11-06T00:00:00Z',
  },
};

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock;
const settings = (google) => json(200, { external: { google, email: true } });

beforeEach(() => {
  limpiarCacheOAuth();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/auth/google', () => {
  it('devuelve la URL de Supabase con PKCE S256 y el verifier', async () => {
    fetchMock.mockResolvedValue(settings(true));
    const res = await request(app).post('/api/auth/google');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');

    const { url, codeVerifier } = res.body.data;
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://test-project.supabase.co/auth/v1/authorize');
    expect(u.searchParams.get('provider')).toBe('google');
    expect(u.searchParams.get('redirect_to')).toBe('http://localhost:5173/auth/callback');
    expect(u.searchParams.get('code_challenge_method')).toBe('s256');
    // El challenge es SHA-256 (base64url) del verifier: nunca el verifier en claro.
    const esperado = createHash('sha256').update(codeVerifier).digest('base64url');
    expect(u.searchParams.get('code_challenge')).toBe(esperado);
    expect(url).not.toContain(codeVerifier);
    expect(fetchMock.mock.calls[0][0]).toBe('https://test-project.supabase.co/auth/v1/settings');
  });

  it('si Google no está activo en Supabase → 503 GOOGLE_DISABLED', async () => {
    fetchMock.mockResolvedValue(settings(false));
    const res = await request(app).post('/api/auth/google');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('GOOGLE_DISABLED');
  });

  it('cachea la consulta de settings y genera un verifier distinto en cada intento', async () => {
    fetchMock.mockImplementation(async () => settings(true));
    const a = await iniciarGoogle();
    const b = await iniciarGoogle();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/auth/google/callback', () => {
  it('canjea el código por la sesión y usa el nombre de Google', async () => {
    fetchMock.mockResolvedValue(json(200, sesionSupabase));
    const res = await request(app)
      .post('/api/auth/google/callback')
      .send({ code: 'codigo-123', codeVerifier: VERIFIER });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      usuario: {
        id: sesionSupabase.user.id,
        email: 'ana@gmail.com',
        nombre: 'Ana Gómez',
        createdAt: '2026-11-06T00:00:00Z',
      },
      sesion: {
        accessToken: 'access-google',
        refreshToken: 'refresh-google',
        expiresIn: 3600,
        expiresAt: 1_900_000_000,
        tokenType: 'bearer',
      },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://test-project.supabase.co/auth/v1/token?grant_type=pkce');
    expect(init.headers.apikey).toBe('sb_publishable_test');
    expect(JSON.parse(init.body)).toEqual({ auth_code: 'codigo-123', code_verifier: VERIFIER });
  });

  it('código vencido o verifier incorrecto → 400 OAUTH_FAILED', async () => {
    fetchMock.mockResolvedValue(
      json(400, { error_code: 'bad_code_verifier', msg: 'code challenge does not match' }),
    );
    const res = await request(app)
      .post('/api/auth/google/callback')
      .send({ code: 'codigo-123', codeVerifier: VERIFIER });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OAUTH_FAILED');
  });

  it('Supabase caído → 502 sin filtrar detalles', async () => {
    fetchMock.mockResolvedValue(json(500, { msg: 'detalle interno' }));
    const res = await request(app)
      .post('/api/auth/google/callback')
      .send({ code: 'codigo-123', codeVerifier: VERIFIER });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('detalle interno');
  });

  it('sin red → 502', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const res = await request(app)
      .post('/api/auth/google/callback')
      .send({ code: 'codigo-123', codeVerifier: VERIFIER });
    expect(res.status).toBe(502);
  });

  it('valida el body antes de llamar a Supabase', async () => {
    const res = await request(app)
      .post('/api/auth/google/callback')
      .send({ code: 'x', codeVerifier: 'corto' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
