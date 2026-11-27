// Carga el dataset limpio y los embeddings en las tablas nuevas de la migración
// 20261120120000_poroteo_ia.sql. Idempotente (upsert). No toca las tablas de origen.
//   node --env-file=.env scripts/supabase/cargar-datos-limpios.mjs
// Funciona contra Supabase local o producción según SUPABASE_URL / SUPABASE_SECRET_KEY.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { DIR_DATASET, DIR_MODELO, leerJsonGz, leerRaw, normalizar } from '../dataset/comun.mjs';
import { GOBIERNOS } from '../../src/prediccion/gobiernos.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});
const ds = (n) => leerJsonGz(join(DIR_DATASET, `${n}.json.gz`));

async function upsert(tabla, filas, onConflict, lote = 500) {
  for (let i = 0; i < filas.length; i += lote) {
    const { error } = await supabase.from(tabla).upsert(filas.slice(i, i + lote), { onConflict });
    if (error) throw new Error(`${tabla} (${i}): ${error.message}`);
  }
  console.log(`${tabla}: ${filas.length} filas`);
}

const bloques = ds('bloques');
const grupos = new Map();
for (const b of bloques)
  grupos.set(b.grupo_id, {
    id: b.grupo_id,
    nombre: b.grupo_nombre,
    nombre_normalizado: b.nombre_normalizado,
  });
// el nombre normalizado del grupo es el de cualquiera de sus variantes (todas normalizan igual)
await upsert('bloques_unificados', [...grupos.values()], 'id');
await upsert(
  'bloques_variantes',
  bloques.map((b) => ({ cv_bloque_id: b.id, bloque_unificado_id: b.grupo_id })),
  'cv_bloque_id',
);
await upsert(
  'gobiernos',
  GOBIERNOS.map((g) => ({
    id: g.id,
    presidente: g.presidente,
    partido: g.partido,
    desde: g.desde,
    hasta: g.hasta,
    criterio_bloque_oficialista: g.bloqueOficialista.source,
  })),
  'id',
);

const grupoPorNombre = new Map([...grupos.values()].map((g) => [g.nombre_normalizado, g.id]));
await upsert(
  'legisladores',
  ds('diputados_actuales').map((d) => ({
    camara: 'diputados',
    persona_id: d.persona_id,
    diputado_id: d.id,
    apellido: d.apellido,
    nombre: d.nombre,
    provincia: d.provincia,
    partido: d.partido_lista_electoral,
    bloque_actual: d.bloque_actual,
    bloque_unificado_id: grupoPorNombre.get(normalizar(d.bloque_actual)) ?? null,
    inicia_mandato: d.inicia_mandato,
    finaliza_mandato: d.finaliza_mandato,
    votaciones_en_historial: d.votaciones_en_historial,
    cambios_de_bloque: d.cambios_de_bloque,
  })),
  'camara,persona_id',
);

// historial_bloques no tiene clave natural: se reemplaza completo.
{
  const { error } = await supabase.from('historial_bloques').delete().gte('id', 0);
  if (error) throw new Error(`historial_bloques (limpiar): ${error.message}`);
  await upsert(
    'historial_bloques',
    ds('historial_bloques').map((h) => ({
      camara: 'diputados',
      persona_id: h.persona_id,
      bloque_unificado_id: h.bloque_grupo_id,
      bloque: h.bloque,
      desde: h.desde,
      hasta: h.hasta,
      votaciones: h.votaciones,
    })),
    'id',
  );
}

const votaciones = ds('votaciones');
await upsert(
  'votaciones_enriquecidas',
  votaciones.map((v) => ({
    votacion_id: v.id,
    camara: v.camara,
    tema: v.tema,
    tipo: v.tipo,
    dictamen: v.dictamen,
    origen_senado: v.origen_senado,
    gobierno_id: v.gobierno,
    postura_oficialismo: v.postura_oficialismo,
    solicitante_persona_id: v.solicitante_persona_id,
    afirmativos: v.afirmativos,
    negativos: v.negativos,
    abstenciones: v.abstenciones,
    ausentes: v.ausentes,
    resultado: v.resultado,
  })),
  'votacion_id',
);

// Provincias completadas: votos que en el origen venían sin provincia.
const provincias = new Map(leerRaw('cv_provincias').map((p) => [p.nombre, p.id]));
const sinProvincia = new Set(
  leerRaw('cv_votos')
    .filter((v) => v.provincia_id === null)
    .map((v) => `${v.votacion_id}-${v.persona_id}`),
);
await upsert(
  'votos_correcciones',
  ds('votos')
    .filter(
      (v) => sinProvincia.has(`${v.votacion_id}-${v.persona_id}`) && provincias.has(v.provincia),
    )
    .map((v) => ({
      votacion_id: v.votacion_id,
      persona_id: v.persona_id,
      provincia_id: provincias.get(v.provincia),
    })),
  'votacion_id,persona_id',
);

const embeddings = leerJsonGz(join(DIR_MODELO, 'embeddings_lsa.json.gz'));
const lsa = leerJsonGz(join(DIR_MODELO, 'lsa.json.gz'));
await upsert(
  'proyectos',
  votaciones.map((v) => ({
    camara: v.camara,
    fuente: 'historico',
    votacion_id: v.id,
    titulo: String(v.titulo).slice(0, 1000),
    resumen: v.nombre_ley,
    tema: v.tema,
    tipo: v.tipo,
    dictamen: v.dictamen,
    origen_senado: v.origen_senado,
    fecha: v.fecha.slice(0, 10),
    embedding: embeddings[v.id] ? `[${embeddings[v.id].vector.join(',')}]` : null,
    version_embedding: `lsa-${lsa.dims}`,
  })),
  'votacion_id',
  250,
);

const modelo = leerJsonGz(join(DIR_MODELO, 'modelo.json.gz'));
const rutaEval = join(DIR_MODELO, 'evaluacion', 'lsa.json');
const ev = existsSync(rutaEval) ? JSON.parse(readFileSync(rutaEval, 'utf8')) : null;
await upsert(
  'modelos_prediccion',
  [
    {
      version: modelo.version,
      tipo: modelo.tipo,
      descripcion:
        'Regresión logística multinomial calibrada + supuestos del escenario (bayes con disciplina).',
      metricas: {
        calibracionUltimos6Meses: modelo.entrenamiento.calibracion,
        backtesting: ev
          ? {
              cortes: ev.cortes,
              accuracy: ev.modelos.logistica.todas.accuracy,
              f1Macro: ev.modelos.logistica.todas.f1Macro,
              ece: ev.modelos.logistica.todas.ece,
            }
          : null,
      },
      datos_al: modelo.entrenamiento.datosAl,
    },
  ],
  'version',
);
console.log('listo');
