// SOLO PARA EL ENTORNO LOCAL: replica las tablas de origen (export de data/raw) en el Postgres
// del Supabase local con COPY. En producción esas tablas ya existen y no se tocan.
//   node scripts/supabase/cargar-origen-local.mjs [contenedor=supabase_db_poroteo-local]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { leerRaw } from '../dataset/comun.mjs';

const CONTENEDOR = process.argv[2] ?? 'supabase_db_poroteo-local';
// Orden respetando dependencias lógicas; columnas = las del esquema local.
const TABLAS = [
  'cv_meta',
  'cv_provincias',
  'cv_bloques',
  'cv_personas',
  'cv_leyes',
  'cv_votaciones',
  'cv_votos',
  'cv_mandatos',
  'cv_elecciones',
  'cv_nombres_originales',
  'distritos',
  'bloques',
  'diputados',
];

function arrayPg(arr) {
  return `{${arr.map((x) => `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
}
function celda(v) {
  if (v === null || v === undefined) return '';
  let s;
  if (Array.isArray(v)) s = arrayPg(v);
  else if (typeof v === 'string') s = v;
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

const dir = join(tmpdir(), 'poroteo-origen');
mkdirSync(dir, { recursive: true });
const psql = (sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql],
    {
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );

psql(`TRUNCATE ${TABLAS.map((t) => `public.${t}`).join(', ')} CASCADE`);
for (const tabla of TABLAS) {
  // cv_meta.valor es jsonb y puede ser un texto: se serializa siempre como JSON.
  const filas = leerRaw(tabla).map((f) =>
    tabla === 'cv_meta' ? { ...f, valor: JSON.stringify(f.valor) } : f,
  );
  const cols = Object.keys(filas[0]);
  const csv = filas.map((f) => cols.map((c) => celda(f[c])).join(',')).join('\n');
  const archivo = join(dir, `${tabla}.csv`);
  writeFileSync(archivo, csv);
  execFileSync('docker', ['cp', archivo, `${CONTENEDOR}:/tmp/${tabla}.csv`]);
  // \copy: lo lee psql dentro del contenedor (el rol postgres local no es superusuario).
  psql(`\\copy public.${tabla} (${cols.join(',')}) FROM '/tmp/${tabla}.csv' WITH (FORMAT csv)`);
  console.log(`${tabla}: ${filas.length}`);
}
psql(`ANALYZE ${TABLAS.map((t) => `public.${t}`).join(', ')}`);
console.log('origen local cargado');
