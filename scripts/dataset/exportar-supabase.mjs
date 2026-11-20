// Exporta las tablas de origen (¿Cómo Votó? + HCDN) de Supabase a data/raw/*.json.gz.
// Solo lectura: no modifica nada en la base. Uso:
//   node --env-file=.env scripts/dataset/exportar-supabase.mjs [tabla ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const URL_BASE = `${process.env.SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
const PAGE = 1000;
const PARALELO = 8;

// tabla → columna de orden estable (PostgREST pagina con order + range)
const TABLAS = {
  cv_meta: 'clave',
  cv_provincias: 'id',
  cv_bloques: 'id',
  cv_personas: 'id',
  cv_mandatos: 'id',
  cv_elecciones: 'id',
  cv_leyes: 'id',
  cv_votaciones: 'id',
  cv_nombres_originales: 'persona_id,camara,nombre_original',
  cv_votos: 'votacion_id,persona_id',
  diputados: 'id',
  bloques: 'id',
  distritos: 'id',
};

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' };

async function pagina(tabla, orden, desde) {
  for (let intento = 1; ; intento++) {
    const res = await fetch(`${URL_BASE}/${tabla}?select=*&order=${orden}`, {
      headers: { ...headers, Range: `${desde}-${desde + PAGE - 1}` },
    });
    if (res.ok) return { filas: await res.json(), rango: res.headers.get('content-range') };
    if (intento >= 5) throw new Error(`${tabla} ${desde}: HTTP ${res.status} ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 1000 * intento));
  }
}

async function exportar(tabla, orden) {
  const primera = await pagina(tabla, orden, 0);
  const total = Number(primera.rango?.split('/')[1] ?? primera.filas.length);
  const desdes = [];
  for (let d = PAGE; d < total; d += PAGE) desdes.push(d);
  const partes = new Array(desdes.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: PARALELO }, async () => {
      while (i < desdes.length) {
        const k = i++;
        partes[k] = (await pagina(tabla, orden, desdes[k])).filas;
      }
    }),
  );
  const filas = primera.filas.concat(...partes);
  if (filas.length !== total)
    throw new Error(`${tabla}: ${filas.length} filas, se esperaban ${total}`);
  return filas;
}

const dir = join(import.meta.dirname, '..', '..', 'data', 'raw');
mkdirSync(dir, { recursive: true });
const pedidas = process.argv.slice(2);
for (const [tabla, orden] of Object.entries(TABLAS)) {
  if (pedidas.length && !pedidas.includes(tabla)) continue;
  const t0 = Date.now();
  const filas = await exportar(tabla, orden);
  writeFileSync(join(dir, `${tabla}.json.gz`), gzipSync(JSON.stringify(filas)));
  console.log(`${tabla}: ${filas.length} filas (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
