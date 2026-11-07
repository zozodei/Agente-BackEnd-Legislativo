import { generateKeyPairSync, sign } from 'node:crypto';
import request from 'supertest';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

const app = createApp();
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const otherKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
const issuer = 'https://test-project.supabase.co/auth/v1';
function jwt(changes = {}, key = privateKey) {
  const header = Buffer.from(
    JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'audit-local' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'user-local',
      iss: issuer,
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...changes,
    }),
  ).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${header}.${payload}.${signature}`;
}
function transport() {
  const fetchMock = vi.fn(async (url) => {
    if (String(url) === `${issuer}/.well-known/jwks.json`)
      return Response.json({
        keys: [
          { ...publicKey.export({ format: 'jwk' }), kid: 'audit-local', alg: 'ES256', use: 'sig' },
        ],
      });
    if (String(url) === `${issuer}/user`)
      return Response.json({
        id: 'user-local',
        email: 'local@example.org',
        email_confirmed_at: '2026-01-01',
        user_metadata: {},
      });
    throw new Error('Transporte no permitido');
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

it('SDK instalado verifica firma ES256 con JWKS local y consulta la identidad actual', async () => {
  const fetchMock = transport();
  const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jwt()}`);
  expect(res.status).toBe(200);
  expect(fetchMock.mock.calls.some(([url]) => String(url) === `${issuer}/user`)).toBe(true);
});

it.each([
  ['falsificado', () => jwt({}, otherKey)],
  ['vencido', () => jwt({ exp: 1 })],
  ['otro emisor', () => jwt({ iss: 'https://otro.supabase.co/auth/v1' })],
  ['otra audiencia', () => jwt({ aud: 'anon' })],
  ['malformado', () => 'falso'],
])('SDK real y política local rechazan token %s con 401', async (_case, token) => {
  transport();
  const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token()}`);
  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe('SESSION_EXPIRED');
});
