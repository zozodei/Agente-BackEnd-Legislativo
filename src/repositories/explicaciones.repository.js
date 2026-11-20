import { supabaseAdmin } from '../config/supabase.js';
import { unwrap } from '../utils/supabaseHelpers.js';

/** @returns {Promise<Map<string, string>>} clave → texto */
export async function fetchExplicaciones(claves) {
  const mapa = new Map();
  for (let i = 0; i < claves.length; i += 200) {
    const { data } = unwrap(
      await supabaseAdmin
        .from('explicaciones_cache')
        .select('clave,texto')
        .in('clave', claves.slice(i, i + 200)),
      'explicaciones.cache',
    );
    for (const fila of data) mapa.set(fila.clave, fila.texto);
  }
  return mapa;
}

export async function guardarExplicaciones(filas) {
  unwrap(
    await supabaseAdmin
      .from('explicaciones_cache')
      .upsert(filas, { onConflict: 'clave', ignoreDuplicates: true }),
    'explicaciones.guardar',
  );
}
