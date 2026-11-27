// Prueba de punta a punta del poroteo con IA contra un backend corriendo (local o desplegado),
// como lo usaría el navegador: cookies HttpOnly + X-Session-Mode + Origin.
//   node --env-file=.env.local scripts/e2e/flujo-poroteo-ia.mjs
// Variables: E2E_API (default http://localhost:4001/api), E2E_ORIGIN (default http://localhost:5173),
//   E2E_EMAIL / E2E_PASSWORD (cuenta existente) o, en LOCAL, SUPABASE_URL + SUPABASE_SECRET_KEY
//   para crear una cuenta de prueba confirmada.
import assert from 'node:assert/strict';

const API = process.env.E2E_API ?? 'http://localhost:4001/api';
const ORIGIN = process.env.E2E_ORIGIN ?? 'http://localhost:5173';
const jar = new Map();
const pasos = [];

async function api(method, path, body) {
  const headers = { 'X-Session-Mode': 'cookie', Origin: ORIGIN };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const t0 = Date.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [par] = c.split(';');
    const i = par.indexOf('=');
    jar.set(par.slice(0, i), par.slice(i + 1));
  }
  const texto = await res.text();
  const json = texto ? JSON.parse(texto) : null;
  return { status: res.status, json, ms: Date.now() - t0 };
}

function paso(nombre, detalle) {
  pasos.push({ nombre, detalle });
  console.log(`✔ ${nombre}${detalle ? ` — ${detalle}` : ''}`);
}

async function cuentaDePrueba() {
  if (process.env.E2E_EMAIL)
    return { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD };
  if (!/127\.0\.0\.1|localhost/.test(process.env.SUPABASE_URL ?? '')) {
    throw new Error(
      'Fuera del entorno local, pasá E2E_EMAIL y E2E_PASSWORD de una cuenta existente.',
    );
  }
  const email = `e2e-${Date.now()}@poroteo.local`;
  const password = 'Prueba-e2e-2026!';
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre: 'Prueba E2E' },
    }),
  });
  assert.equal(res.status, 200, `crear cuenta local: ${await res.text()}`);
  return { email, password };
}

const { email, password } = await cuentaDePrueba();
let r = await api('POST', '/auth/login', { email, password });
assert.equal(r.status, 200, JSON.stringify(r.json));
paso('Inicio de sesión con cookies', email);

r = await api('GET', '/prediccion/modelo');
assert.equal(r.status, 200);
paso('Modelo disponible', r.json.data.version);

const titulo =
  process.env.E2E_TITULO ??
  'Ley de financiamiento universitario y recomposición del salario docente';
r = await api('POST', '/prediccion/analizar', { titulo });
assert.equal(r.status, 200, JSON.stringify(r.json));
paso(
  'Análisis del proyecto',
  `tema ${r.json.data.tema}; parecida: ${r.json.data.similares[0]?.titulo.slice(0, 60)}`,
);

r = await api('POST', '/poroteos', {
  titulo,
  descripcion: 'Prueba de punta a punta',
  tipoMayoria: 'simple',
});
assert.equal(r.status, 201, JSON.stringify(r.json));
let poroteo = r.json.data;
paso('Poroteo creado', poroteo.id);

r = await api('POST', `/poroteos/${poroteo.id}/prediccion`, {
  version: poroteo.version,
  supuestos: {},
});
assert.equal(r.status, 200, JSON.stringify(r.json));
poroteo = r.json.data.poroteo;
let pred = r.json.data.prediccion;
assert.equal(pred.predicciones.length, 257);
assert.equal(poroteo.votos.length, 257);
assert.equal(poroteo.origen, 'ia');
for (const p of pred.predicciones) {
  const suma = Object.values(p.probabilidades).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(suma - 1) < 0.01, 'probabilidades suman 1');
  assert.ok(p.explicacion && p.explicacion.length > 40, 'hay explicación');
  assert.ok(p.factores?.similares, 'factores auditables');
}
const r0 = poroteo.resumen;
paso(
  'Predicción de los 257',
  `${r.ms} ms · ${r0.conteo.AFIRMATIVO} A / ${r0.conteo.NEGATIVO} N / ${r0.conteo.ABSTENCION} Abs / ${r0.conteo.AUSENTE} Aus → ${r0.resultado}`,
);

// Ajuste manual de un diputado que la IA puso afirmativo
const elegido = pred.predicciones.find((p) => p.voto === 'AFIRMATIVO');
r = await api('POST', `/poroteos/${poroteo.id}/ajustes`, {
  version: poroteo.version,
  ajustes: [
    {
      diputadoId: elegido.diputadoId,
      voto: 'NEGATIVO',
      motivo: 'Anunció su voto en contra (prueba)',
    },
  ],
});
assert.equal(r.status, 200, JSON.stringify(r.json));
poroteo = r.json.data.poroteo;
pred = r.json.data.prediccion;
assert.equal(poroteo.resumen.conteo.AFIRMATIVO, r0.conteo.AFIRMATIVO - 1);
assert.equal(poroteo.resumen.conteo.NEGATIVO, r0.conteo.NEGATIVO + 1);
assert.equal(poroteo.origen, 'mixto');
assert.equal(poroteo.votos.find((v) => v.diputadoId === elegido.diputadoId).origen, 'manual');
paso(
  'Ajuste manual y totales recalculados',
  `${poroteo.resumen.conteo.AFIRMATIVO} A / ${poroteo.resumen.conteo.NEGATIVO} N`,
);

// Versión vieja → 409 (no se pisa el trabajo de otra persona)
r = await api('POST', `/poroteos/${poroteo.id}/ajustes`, {
  version: 1,
  ajustes: [{ diputadoId: elegido.diputadoId, voto: 'AUSENTE' }],
});
assert.equal(r.status, 409);
paso('Conflicto de versión detectado', '409');

// Volver a la predicción
r = await api('POST', `/poroteos/${poroteo.id}/ajustes`, {
  version: poroteo.version,
  ajustes: [{ diputadoId: elegido.diputadoId, voto: null }],
});
assert.equal(r.status, 200, JSON.stringify(r.json));
poroteo = r.json.data.poroteo;
pred = r.json.data.prediccion;
assert.equal(poroteo.resumen.conteo.AFIRMATIVO, r0.conteo.AFIRMATIVO);
assert.equal(pred.historialAjustes.length, 2);
assert.equal(pred.ajustesVigentes.length, 0);
paso(
  'Volver a la predicción de la IA',
  `historial con ${pred.historialAjustes.length} ajustes conservados`,
);

// Re-estimar con supuestos: el ajuste vigente se respeta
r = await api('POST', `/poroteos/${poroteo.id}/ajustes`, {
  version: poroteo.version,
  ajustes: [{ diputadoId: elegido.diputadoId, voto: 'ABSTENCION' }],
});
poroteo = r.json.data.poroteo;
r = await api('POST', `/poroteos/${poroteo.id}/prediccion`, {
  version: poroteo.version,
  supuestos: {
    posturaOficialismo: 'NEGATIVO',
    posturasBloque: { 'UNIÓN POR LA PATRIA': 'AFIRMATIVO' },
  },
});
assert.equal(r.status, 200, JSON.stringify(r.json));
poroteo = r.json.data.poroteo;
assert.equal(poroteo.votos.find((v) => v.diputadoId === elegido.diputadoId).voto, 'ABSTENCION');
const r2 = poroteo.resumen;
paso(
  'Re-estimación con supuestos (ajuste manual respetado)',
  `${r2.conteo.AFIRMATIVO} A / ${r2.conteo.NEGATIVO} N → ${r2.resultado}`,
);

r = await api('GET', `/poroteos/${poroteo.id}/resultado?tipoMayoria=dos_tercios`);
assert.equal(r.status, 200);
paso(
  'Mayoría especial (dos tercios)',
  `${r.json.data.resumen.resultado}, requiere ${r.json.data.resumen.mayoria.requeridos}`,
);

r = await api('DELETE', `/poroteos/${poroteo.id}`, { version: poroteo.version });
assert.equal(r.status, 204);
paso('Limpieza: poroteo de prueba borrado');
console.log(`\nE2E OK (${pasos.length} pasos)`);
