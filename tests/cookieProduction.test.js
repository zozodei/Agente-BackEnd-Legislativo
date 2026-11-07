import { expect, it, vi } from 'vitest';
vi.mock('../src/config/env.js', () => ({
  isProduction: true,
  env: { SESSION_SAME_SITE: 'none', SESSION_DAYS: 7 },
}));
const { respondAuth, clearSessionCookies } = await import('../src/middlewares/sessionSecurity.js');
it('producción exige cookies Secure HttpOnly sin Domain, con borrado del mismo scope', () => {
  const res = { cookie: vi.fn(), clearCookie: vi.fn(), status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  respondAuth({ cookieSession: true }, res, {
    usuario: { id: 'u' },
    sesion: {
      accessToken: 'falso',
      refreshToken: 'falso-refresh',
      expiresIn: 3600,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      tokenType: 'bearer',
    },
  });
  expect(res.cookie.mock.calls[0][0]).toBe('__Secure-poroteo_access');
  for (const [, , options] of res.cookie.mock.calls) {
    expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'none' });
    expect(options.domain).toBeUndefined();
  }
  clearSessionCookies(res);
  for (let i = 0; i < 2; i++) {
    expect(res.clearCookie.mock.calls[i][0]).toBe(res.cookie.mock.calls[i][0]);
    expect(res.clearCookie.mock.calls[i][1].path).toBe(res.cookie.mock.calls[i][2].path);
  }
});
