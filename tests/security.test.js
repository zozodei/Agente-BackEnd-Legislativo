import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';
import { verifiedClaims } from './claims.fixture.js';

vi.mock('../src/config/supabaseAuth.js', () => ({ createAuthClient: vi.fn() }));
const { createAuthClient } = await import('../src/config/supabaseAuth.js');
const { createApp } = await import('../src/app.js');
const { extractPdfText } = await import('../src/services/pdf.service.js');
const { registroBody } = await import('../src/validators/auth.validator.js');
const app = createApp();
const user = { id: 'test-user', email: 'ana@example.org', email_confirmed_at: '2026-01-01' };
const session = {
  access_token: 'secret-access',
  refresh_token: 'secret-refresh',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
};
let auth;
let counter = 0;
const browser = (method, path) =>
  request(app)
    [method](`/api${path}`)
    .set('Origin', 'http://localhost:5173')
    .set('X-Session-Mode', 'cookie')
    .set('X-Forwarded-For', `198.51.100.${++counter}`);
beforeEach(() => {
  auth = {
    getClaims: vi.fn().mockResolvedValue(verifiedClaims(user.id)),
    getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user, session }, error: null }),
    refreshSession: vi.fn().mockResolvedValue({ data: { user, session }, error: null }),
    admin: { signOut: vi.fn().mockResolvedValue({ data: null, error: null }) },
  };
  createAuthClient.mockReturnValue({ auth });
});

it('login cookie entrega solo vencimientos, cookies HttpOnly host-only y paths limitados', async () => {
  const res = await browser('post', '/auth/login').send({
    email: user.email,
    password: '12345678',
  });
  expect(res.status).toBe(200);
  expect(JSON.stringify(res.body)).not.toMatch(
    /secret-access|secret-refresh|accessToken|refreshToken/,
  );
  const cookies = res.headers['set-cookie'];
  expect(cookies).toHaveLength(2);
  expect(cookies[0]).toMatch(/Path=\/api;.*HttpOnly; SameSite=Lax/);
  expect(cookies[1]).toMatch(/Path=\/api\/auth;.*HttpOnly; SameSite=Lax/);
  expect(cookies.join()).not.toContain('Domain=');
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.headers['access-control-allow-credentials']).toBe('true');
});

it.each([
  ['sin encabezado', null, 'http://localhost:5173'],
  ['sin origen', 'cookie', null],
  ['origen ajeno', 'cookie', 'https://evil.example'],
])('CSRF rechaza %s incluso con Bearer y cookies', async (_name, mode, origin) => {
  let req = request(app)
    .patch('/api/poroteos/11111111-1111-4111-8111-111111111111')
    .set('Cookie', 'poroteo_access=secret-access')
    .set('Authorization', 'Bearer token');
  if (mode) req = req.set('X-Session-Mode', mode);
  if (origin) req = req.set('Origin', origin);
  const res = await req.send({ version: 1, titulo: 'Intento' });
  expect(res.status).toBe(403);
  expect(auth.getUser).not.toHaveBeenCalled();
});

it('CSRF protege login antes de crear la sesión', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .set('X-Session-Mode', 'cookie')
    .send({ email: user.email, password: '12345678' });
  expect(res.status).toBe(403);
  expect(auth.signInWithPassword).not.toHaveBeenCalled();
});

it('refresh usa exclusivamente la cookie, sin devolver secretos al navegador', async () => {
  const res = await browser('post', '/auth/refresh')
    .set('Cookie', 'poroteo_refresh=real-refresh')
    .send({ refreshToken: 'actor-manipulado' });
  expect(res.status).toBe(200);
  expect(auth.refreshSession).toHaveBeenCalledWith({ refresh_token: 'real-refresh' });
  expect(JSON.stringify(res.body)).not.toContain('secret-');
});

it('refresh sin cookie es 401; logout borra las cookies aun si Auth falla', async () => {
  expect((await browser('post', '/auth/refresh').send({})).status).toBe(401);
  auth.admin.signOut.mockResolvedValue({ error: { status: 503 } });
  const res = await browser('post', '/auth/logout').set('Cookie', 'poroteo_access=old-access');
  expect(res.status).toBe(502);
  expect(res.headers['set-cookie'].join()).toContain('Expires=Thu, 01 Jan 1970');
});

it('identidad cookie se verifica con JWT oficial y getUser actual', async () => {
  const res = await browser('get', '/auth/me').set('Cookie', 'poroteo_access=secret-access');
  expect(res.status).toBe(200);
  expect(auth.getClaims).toHaveBeenCalledWith('secret-access');
  expect(auth.getUser).toHaveBeenCalledWith('secret-access');
});

it('una pestaña con identidad anterior no ejecuta operaciones con cookies de otra cuenta', async () => {
  const res = await browser('patch', '/poroteos/11111111-1111-4111-8111-111111111111')
    .set('Cookie', 'poroteo_access=secret-access')
    .set('X-Expected-User', '22222222-2222-4222-8222-222222222222')
    .send({ version: 1, titulo: 'No cambiar' });
  expect(res.status).toBe(401);
  expect(auth.getUser).toHaveBeenCalled();
});

it.each([
  { iss: 'https://otro.supabase.co/auth/v1' },
  { aud: 'anon' },
  { exp: 1 },
  { sub: 'otro' },
])('rechaza claims firmados pero fuera del contrato: %j', async (patch) => {
  const verified = verifiedClaims(user.id);
  Object.assign(verified.data.claims, patch);
  auth.getClaims.mockResolvedValue(verified);
  const res = await browser('get', '/auth/me').set('Cookie', 'poroteo_access=jwt');
  expect(res.status).toBe(401);
  expect(JSON.stringify(res.body)).not.toContain('jwt');
});

it('tokens en query no autentican y no se reflejan en el error 404', async () => {
  expect((await request(app).get('/api/auth/me?access_token=no-imprimir')).status).toBe(401);
  const res = await request(app).get('/api/inexistente?access_token=no-imprimir');
  expect(res.status).toBe(404);
  expect(JSON.stringify(res.body)).not.toContain('no-imprimir');
});

it('contraseñas Unicode se limitan por bytes sin recortar ni doble hashing', () => {
  expect(
    registroBody.safeParse({ nombre: 'Ana', email: user.email, password: 'é'.repeat(37) }).success,
  ).toBe(false);
  expect(
    registroBody.parse({ nombre: 'Ana', email: user.email, password: ' clave123 ' }).password,
  ).toBe(' clave123 ');
});

it('no confía en MIME ni extensión del PDF, rechaza contenido y documentos corruptos', async () => {
  await expect(extractPdfText(Buffer.from('HTML'))).rejects.toMatchObject({ status: 400 });
  await expect(extractPdfText(Buffer.from('%PDF-1.7\ncorrupto'))).rejects.toMatchObject({
    status: 400,
  });
});

it('PDF inválido no llega a la base y el límite por usuario resiste cambiar la IP', async () => {
  for (let i = 0; i < 5; i++) {
    const res = await browser('post', '/poroteos')
      .set('Cookie', 'poroteo_access=secret-access')
      .field('titulo', 'Ley de prueba')
      .attach('archivo', Buffer.from('No es un PDF'), {
        filename: 'mentira.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/PDF/);
  }
  const limited = await browser('post', '/poroteos')
    .set('Cookie', 'poroteo_access=secret-access')
    .field('titulo', 'Ley de prueba')
    .attach('archivo', Buffer.from('No es un PDF'), {
      filename: 'mentira.pdf',
      contentType: 'application/pdf',
    });
  expect(limited.status).toBe(429);
});

it('extrae un PDF válido en el worker sin ejecutar HTML del texto', async () => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = 'BT /F1 12 Tf 72 720 Td (Ley <script>texto</script>) Tj ET';
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let file = '%PDF-1.4\n';
  const offsets = [];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(file));
    file += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(file);
  file += 'xref\n0 6\n0000000000 65535 f \n';
  file += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  file += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await expect(extractPdfText(Buffer.from(file))).resolves.toContain('Ley <script>texto</script>');
});
