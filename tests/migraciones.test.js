import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it.each([
  [
    '20261106234252_poroteos_miembros_publicacion_y_concurrencia.sql',
    '1c4e69c393154b91bae8f92984d563d8fc206e63c293afd82c7424ef91cecdf8',
  ],
  [
    '20261106234430_retirar_busqueda_directa_cuentas_auth.sql',
    '9f3953b15e2dde11d4eddc3bc1d10ba33563bb709be1f1cafdefcf7f761ae38e',
  ],
])('conserva byte por byte el SQL exportado del historial: %s', (file, sha) => {
  const sql = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url));
  expect(createHash('sha256').update(sql).digest('hex')).toBe(sha);
});
