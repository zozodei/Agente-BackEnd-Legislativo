import { afterEach, expect, it, vi } from 'vitest';
import { createAuthClient } from '../src/config/supabaseAuth.js';
import { logout } from '../src/services/auth.service.js';

afterEach(() => vi.unstubAllGlobals());

it('el SDK real usa clave pública y mantiene cada sesión aislada, con transporte simulado', async () => {
  const requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes('/logout')) return new Response(null, { status: 204 });
      const { email } = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          access_token: `access-${email}`,
          refresh_token: `refresh-${email}`,
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'bearer',
          user: {
            id: email,
            email,
            aud: 'authenticated',
            role: 'authenticated',
            user_metadata: {},
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );
  const primero = createAuthClient();
  const segundo = createAuthClient();
  expect(primero).not.toBe(segundo);
  await primero.auth.signInWithPassword({ email: 'uno@example.org', password: 'clave123' });
  await segundo.auth.signInWithPassword({ email: 'dos@example.org', password: 'clave123' });
  expect((await primero.auth.getSession()).data.session.user.email).toBe('uno@example.org');
  expect((await segundo.auth.getSession()).data.session.user.email).toBe('dos@example.org');
  const logout = await primero.auth.admin.signOut('access-uno@example.org', 'local');
  expect(logout.error).toBeNull();
  expect(requests).toHaveLength(3);
  for (const { options } of requests) {
    expect(new Headers(options.headers).get('apikey')).toBe('sb_publishable_test');
    expect(JSON.stringify(options)).not.toContain('sb_secret_test');
  }
  expect(requests[2].url).toContain('/logout?scope=local');
  expect(new Headers(requests[2].options.headers).get('authorization')).toBe(
    'Bearer access-uno@example.org',
  );
});

it('logout con refresh usa el SDK real y scope local con transporte aislado', async () => {
  const requests = [];
  // Otra sesión de la misma cuenta y otra cuenta deben permanecer intactas.
  const sessions = new Set(['sesion-a', 'sesion-a-otra', 'sesion-b']);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options) => {
      const target = new URL(String(url));
      const headers = new Headers(options.headers);
      expect(target.origin).toBe('https://test-project.supabase.co');
      expect(headers.get('apikey')).toBe('sb_publishable_test');
      requests.push({ target, headers });
      if (target.pathname.endsWith('/token')) {
        expect(target.searchParams.get('grant_type')).toBe('refresh_token');
        expect(JSON.parse(options.body)).toEqual({ refresh_token: 'refresh-sesion-a' });
        return Response.json({
          access_token: 'access-nuevo-sesion-a',
          refresh_token: 'refresh-rotado-sesion-a',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'bearer',
          user: { id: 'cuenta-a', email: 'a@example.org', aud: 'authenticated', user_metadata: {} },
        });
      }
      if (target.pathname.endsWith('/logout')) {
        expect(target.searchParams.get('scope')).toBe('local');
        expect(headers.get('authorization')).toBe('Bearer access-nuevo-sesion-a');
        sessions.delete('sesion-a');
        return new Response(null, { status: 204 });
      }
      throw new Error('Transporte inesperado: no se permite red real');
    }),
  );
  await logout(undefined, 'refresh-sesion-a');
  expect(requests).toHaveLength(2);
  expect(sessions).toEqual(new Set(['sesion-a-otra', 'sesion-b']));
});
