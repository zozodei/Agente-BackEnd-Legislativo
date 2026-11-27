// Construye el dataset limpio y enriquecido a partir de data/raw (export de Supabase).
// No modifica data/raw: todo lo derivado va a data/dataset/. Uso:
//   node scripts/dataset/construir.mjs
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { leerRaw, normalizar, escribirCsv, escribirJsonGz, DIR_DATASET } from './comun.mjs';
import {
  clasificarTema,
  analizarTitulo,
  extraerSolicitante,
} from '../../src/prediccion/proyecto.js';
import { GOBIERNOS, gobiernoEn, esBloqueOficialista } from '../../src/prediccion/gobiernos.js';

const informe = { generado: new Date().toISOString(), problemas: {}, decisiones: [] };
const anotar = (clave, valor) => (informe.problemas[clave] = valor);

const votacionesRaw = leerRaw('cv_votaciones');
const votosRaw = leerRaw('cv_votos');
const personasRaw = leerRaw('cv_personas');
const bloquesRaw = leerRaw('cv_bloques');
const provinciasRaw = leerRaw('cv_provincias');
const eleccionesRaw = leerRaw('cv_elecciones');
const leyesRaw = leerRaw('cv_leyes');
const diputadosRaw = leerRaw('diputados');
const bloquesActualesRaw = leerRaw('bloques');
const distritosRaw = leerRaw('distritos');
const meta = Object.fromEntries(leerRaw('cv_meta').map((m) => [m.clave, m.valor]));

// ---------------------------------------------------------------- bloques
// Mismo bloque escrito distinto ("Coalicion Civica" / "Coalición Cívica") → misma clave.
const grupos = new Map();
const bloques = bloquesRaw.map((b) => {
  const clave = normalizar(b.nombre) || 'sin bloque';
  if (!grupos.has(clave)) grupos.set(clave, { id: grupos.size + 1, nombre: b.nombre, ids: [] });
  const g = grupos.get(clave);
  g.ids.push(b.id);
  // Preferimos el nombre con tildes/mayúsculas mixtas como nombre visible.
  if (/[áéíóúÁÉÍÓÚ]/.test(b.nombre) && !/[áéíóúÁÉÍÓÚ]/.test(g.nombre)) g.nombre = b.nombre;
  return {
    id: b.id,
    nombre: b.nombre,
    nombre_normalizado: clave,
    grupo_id: g.id,
    coalicion_fuente: b.coalicion,
  };
});
for (const b of bloques)
  b.grupo_nombre = [...grupos.values()].find((g) => g.id === b.grupo_id).nombre;
const bloquePorId = new Map(bloques.map((b) => [b.id, b]));
anotar('bloques_con_variantes_de_nombre', {
  bloques_fuente: bloquesRaw.length,
  bloques_unificados: grupos.size,
  ejemplos: [...grupos.values()]
    .filter((g) => g.ids.length > 1)
    .slice(0, 10)
    .map((g) => g.ids.map((id) => bloquePorId.get(id).nombre)),
});
anotar(
  'coalicion_fuente_inconsistente',
  'La columna coalicion de cv_bloques asigna, por ejemplo, "Unión Cívica Radical" a PRO. ' +
    'No se usa como verdad: la relación con el oficialismo se mide con los votos (ver postura_oficialismo).',
);

const provinciaPorId = new Map(provinciasRaw.map((p) => [p.id, p.nombre]));

// ---------------------------------------------------------------- votaciones
const votacionPorId = new Map(votacionesRaw.map((v) => [v.id, v]));
const votosPorVotacion = new Map();
for (const v of votosRaw) {
  if (!votosPorVotacion.has(v.votacion_id)) votosPorVotacion.set(v.votacion_id, []);
  votosPorVotacion.get(v.votacion_id).push(v);
}

// Provincia faltante en votos: se completa con la provincia de la misma persona en la votación
// más cercana en el tiempo (la provincia de una banca no cambia dentro de un mandato).
const votosPorPersona = new Map();
for (const v of votosRaw) {
  if (!votosPorPersona.has(v.persona_id)) votosPorPersona.set(v.persona_id, []);
  votosPorPersona.get(v.persona_id).push(v);
}
let provinciasCompletadas = 0;
let provinciasSinResolver = 0;
const provinciaVoto = new Map(); // `${votacion}-${persona}` → provincia_id
for (const [, lista] of votosPorPersona) {
  lista.sort((a, b) =>
    votacionPorId.get(a.votacion_id).fecha.localeCompare(votacionPorId.get(b.votacion_id).fecha),
  );
  for (let i = 0; i < lista.length; i++) {
    if ((lista[i].provincia_id ?? null) !== null) continue;
    let encontrada = null;
    for (let d = 1; d < lista.length && (encontrada ?? null) === null; d++) {
      encontrada = lista[i - d]?.provincia_id ?? lista[i + d]?.provincia_id ?? null;
    }
    if ((encontrada ?? null) !== null) {
      provinciaVoto.set(`${lista[i].votacion_id}-${lista[i].persona_id}`, encontrada);
      provinciasCompletadas++;
    } else provinciasSinResolver++;
  }
}
anotar('votos_sin_provincia', {
  total: provinciasCompletadas + provinciasSinResolver,
  completadas: provinciasCompletadas,
  sin_resolver: provinciasSinResolver,
});

const personaPorId = new Map(personasRaw.map((p) => [p.id, p]));
let discrepanciasConteo = 0;
let resultadosNumericos = 0;
let solicitantesResueltos = 0;
const solicitantesNoResueltos = [];
let sinPosturaOficialismo = 0;

function mayoria(conteo) {
  // conteo: {AFIRMATIVO, NEGATIVO, ABSTENCION} entre presentes
  const orden = ['AFIRMATIVO', 'NEGATIVO', 'ABSTENCION'].sort(
    (a, b) => (conteo[b] ?? 0) - (conteo[a] ?? 0),
  );
  return (conteo[orden[0]] ?? 0) > 0 ? orden[0] : null;
}

const votaciones = votacionesRaw
  .slice()
  .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id)
  .map((v) => {
    const votos = votosPorVotacion.get(v.id) ?? [];
    const conteo = { AFIRMATIVO: 0, NEGATIVO: 0, ABSTENCION: 0, AUSENTE: 0, PRESIDENTE: 0 };
    for (const x of votos) conteo[x.voto]++;
    if (
      conteo.AFIRMATIVO !== v.afirmativos ||
      conteo.NEGATIVO !== v.negativos ||
      conteo.ABSTENCION !== v.abstenciones ||
      conteo.AUSENTE !== v.ausentes
    )
      discrepanciasConteo++;

    let resultado = v.resultado;
    if (!['AFIRMATIVO', 'NEGATIVO', 'EMPATE'].includes(resultado)) {
      resultadosNumericos++;
      resultado =
        conteo.AFIRMATIVO > conteo.NEGATIVO
          ? 'AFIRMATIVO'
          : conteo.AFIRMATIVO < conteo.NEGATIVO
            ? 'NEGATIVO'
            : 'EMPATE';
    }

    const gobierno = gobiernoEn(v.fecha);
    const oficialistas = { AFIRMATIVO: 0, NEGATIVO: 0, ABSTENCION: 0 };
    let nOficialistas = 0;
    for (const x of votos) {
      const b = bloquePorId.get(x.bloque_id);
      if (b && esBloqueOficialista(b.nombre_normalizado, v.fecha)) {
        nOficialistas++;
        if (x.voto in oficialistas) oficialistas[x.voto]++;
      }
    }
    const posturaOficialismo = mayoria(oficialistas);
    if (!posturaOficialismo) sinPosturaOficialismo++;

    const rasgos = analizarTitulo(v.titulo);
    const solicitante = extraerSolicitante(v.titulo);
    let solicitantePersona = null;
    let solicitanteBloque = null;
    if (solicitante) {
      const candidatos = votos.filter((x) => {
        const [apCrudo, noCrudo] = String(personaPorId.get(x.persona_id)?.nombre ?? '').split(',');
        const ap = normalizar(apCrudo);
        const no = normalizar(noCrudo);
        const s = solicitante.apellido;
        if (!ap || !(ap === s || ap.startsWith(`${s} `) || s.startsWith(`${ap} `))) return false;
        return !solicitante.nombre || !no || no.split(' ')[0] === solicitante.nombre.split(' ')[0];
      });
      if (candidatos.length === 1) {
        solicitantePersona = candidatos[0].persona_id;
        solicitanteBloque = bloquePorId.get(candidatos[0].bloque_id)?.grupo_id ?? null;
        solicitantesResueltos++;
      } else
        solicitantesNoResueltos.push(
          `${v.id}: ${solicitante.crudo} (${candidatos.length} candidatos)`,
        );
    }

    const ley = v.ley_id ? leyesRaw.find((l) => l.id === v.ley_id) : null;
    const tema = clasificarTema(v.titulo, v.nombre_ley, ley?.nombre, (v.keywords ?? []).join(' '));

    return {
      id: v.id,
      id_hcdn: v.id_origen,
      camara: v.camara,
      fecha: v.fecha,
      anio: v.anio,
      titulo: v.titulo,
      nombre_ley: v.nombre_ley,
      ley_id: v.ley_id,
      etiqueta: v.etiqueta,
      es_general: v.es_general,
      tipo: rasgos.tipo,
      dictamen: rasgos.dictamen,
      origen_senado: rasgos.origenSenado,
      tema,
      keywords: (v.keywords ?? []).join('; '),
      resultado,
      resultado_original: v.resultado,
      afirmativos: conteo.AFIRMATIVO,
      negativos: conteo.NEGATIVO,
      abstenciones: conteo.ABSTENCION,
      ausentes: conteo.AUSENTE,
      presidente: conteo.PRESIDENTE,
      gobierno: gobierno?.id ?? null,
      oficialistas_en_recinto: nOficialistas,
      postura_oficialismo: posturaOficialismo,
      solicitante_persona_id: solicitantePersona,
      solicitante_bloque_grupo_id: solicitanteBloque,
      url_acta: v.url,
    };
  });
anotar('conteos_distintos_a_los_votos', {
  votaciones: discrepanciasConteo,
  causa:
    'En cv_votaciones las columnas afirmativos/negativos/abstenciones/ausentes están corridas un lugar (afirmativos guarda negativos, etc.; ausentes = 0). conteo_coaliciones.tot sí coincide con los votos.',
  decision:
    'Los conteos del dataset limpio se recalculan desde cv_votos. El backend usa conteo_coaliciones.tot.',
});
anotar('resultado_numerico', {
  votaciones: resultadosNumericos,
  decision:
    'Se recalcula comparando afirmativos y negativos; el original queda en resultado_original.',
});
anotar('mociones_con_solicitante', {
  resueltos: solicitantesResueltos,
  no_resueltos: solicitantesNoResueltos.length,
  ejemplos_no_resueltos: solicitantesNoResueltos.slice(0, 15),
});
anotar('votaciones_sin_postura_oficialismo', {
  total: sinPosturaOficialismo,
  motivo:
    'Ningún diputado del bloque del presidente votó (p. ej. 1993–1995 con nombres de bloque distintos o todos ausentes).',
});

// ---------------------------------------------------------------- historial de bloques
// Tramos consecutivos del mismo bloque (unificado) por persona, según sus votos.
const historial = [];
const cambiosPorPersona = new Map();
for (const [personaId, lista] of votosPorPersona) {
  let tramo = null;
  for (const x of lista) {
    const fecha = votacionPorId.get(x.votacion_id).fecha.slice(0, 10);
    const grupo = bloquePorId.get(x.bloque_id)?.grupo_id;
    if (!tramo || tramo.bloque_grupo_id !== grupo) {
      if (tramo) historial.push(tramo);
      tramo = {
        persona_id: personaId,
        bloque_grupo_id: grupo,
        bloque: bloquePorId.get(x.bloque_id)?.grupo_nombre,
        desde: fecha,
        hasta: fecha,
        votaciones: 0,
      };
    }
    tramo.hasta = fecha;
    tramo.votaciones++;
  }
  if (tramo) historial.push(tramo);
}
for (const h of historial)
  cambiosPorPersona.set(h.persona_id, (cambiosPorPersona.get(h.persona_id) ?? -1) + 1);
anotar(
  'personas_que_cambiaron_de_bloque',
  [...cambiosPorPersona.values()].filter((c) => c > 0).length,
);

// ---------------------------------------------------------------- personas
const eleccionesPorPersona = new Map();
for (const e of eleccionesRaw) {
  if ((e.persona_id ?? null) === null || e.camara !== 'diputados') continue;
  const prev = eleccionesPorPersona.get(e.persona_id);
  if (!prev || e.anio > prev.anio) eleccionesPorPersona.set(e.persona_id, e);
}
const nombresNormalizados = new Map();
for (const p of personasRaw) {
  const n = normalizar(p.nombre);
  nombresNormalizados.set(n, (nombresNormalizados.get(n) ?? 0) + 1);
}
anotar(
  'personas_con_nombre_repetido',
  [...nombresNormalizados].filter(([, c]) => c > 1).map(([n]) => n),
);
anotar(
  'personas_invalidas',
  personasRaw
    .filter((p) => normalizar(p.nombre).length < 3)
    .map((p) => ({ id: p.id, nombre: p.nombre, votos: p.total_votaciones })),
);

const personas = personasRaw.map((p) => {
  const lista = votosPorPersona.get(p.id) ?? [];
  const ultimo = lista.at(-1);
  const e = eleccionesPorPersona.get(p.id);
  return {
    id: p.id,
    nombre: p.nombre,
    provincia: p.provincia,
    bloque_actual_fuente: p.bloque_actual,
    ultimo_bloque_votado: ultimo ? bloquePorId.get(ultimo.bloque_id)?.grupo_nombre : null,
    ultimo_voto_fecha: ultimo ? votacionPorId.get(ultimo.votacion_id).fecha.slice(0, 10) : null,
    primer_voto_fecha: lista[0] ? votacionPorId.get(lista[0].votacion_id).fecha.slice(0, 10) : null,
    votaciones: lista.length,
    presentismo: p.presentismo,
    cambios_de_bloque: cambiosPorPersona.get(p.id) ?? 0,
    ultima_lista_electoral: e?.alianza ?? null,
    ultima_eleccion_anio: e?.anio ?? null,
    foto: p.foto,
  };
});

// ---------------------------------------------------------------- diputados actuales (257)
const bloqueActualPorId = new Map(bloquesActualesRaw.map((b) => [b.id, b.nombre]));
const distritoPorId = new Map(distritosRaw.map((d) => [d.id, d.nombre]));
const personaLimpia = new Map(personas.map((p) => [p.id, p]));
const diputados = diputadosRaw.map((d) => {
  const p = personaLimpia.get(d.cv_persona_id);
  const tramos = historial.filter((h) => h.persona_id === d.cv_persona_id);
  return {
    id: d.id,
    persona_id: d.cv_persona_id,
    apellido: d.apellido,
    nombre: d.nombre,
    provincia: distritoPorId.get(d.distrito_id),
    bloque_actual: bloqueActualPorId.get(d.bloque_id),
    ultimo_bloque_votado: p?.ultimo_bloque_votado ?? null,
    partido_lista_electoral: p?.ultima_lista_electoral ?? null,
    inicia_mandato: d.inicia_mandato,
    finaliza_mandato: d.finaliza_mandato,
    camara: 'diputados',
    votaciones_en_historial: p?.votaciones ?? 0,
    presentismo: p?.presentismo ?? null,
    cambios_de_bloque: p?.cambios_de_bloque ?? 0,
    historial_bloques: tramos.map((t) => `${t.bloque} (${t.desde} a ${t.hasta})`).join(' | '),
  };
});
anotar(
  'diputados_actuales_sin_historial',
  diputados.filter((d) => d.votaciones_en_historial === 0).map((d) => `${d.apellido}, ${d.nombre}`),
);

// ---------------------------------------------------------------- votos
const votos = [];
for (const v of votaciones) {
  for (const x of votosPorVotacion.get(v.id) ?? []) {
    const b = bloquePorId.get(x.bloque_id);
    const prov = x.provincia_id ?? provinciaVoto.get(`${v.id}-${x.persona_id}`) ?? null;
    votos.push({
      votacion_id: v.id,
      persona_id: x.persona_id,
      voto: x.voto,
      bloque_id: x.bloque_id,
      bloque_grupo_id: b?.grupo_id ?? null,
      provincia: provinciaPorId.get(prov) ?? null,
    });
  }
}

// ---------------------------------------------------------------- escribir
escribirCsv(join(DIR_DATASET, 'votaciones.csv'), votaciones);
escribirCsv(join(DIR_DATASET, 'personas.csv'), personas);
escribirCsv(join(DIR_DATASET, 'diputados_actuales.csv'), diputados);
escribirCsv(join(DIR_DATASET, 'bloques.csv'), bloques, [
  'id',
  'nombre',
  'nombre_normalizado',
  'grupo_id',
  'grupo_nombre',
  'coalicion_fuente',
]);
escribirCsv(join(DIR_DATASET, 'historial_bloques.csv'), historial);
escribirCsv(
  join(DIR_DATASET, 'gobiernos.csv'),
  GOBIERNOS.map((g) => ({
    id: g.id,
    presidente: g.presidente,
    partido: g.partido,
    desde: g.desde,
    hasta: g.hasta ?? '',
    criterio_bloque_oficialista: g.bloqueOficialista.source,
  })),
);
escribirJsonGz(join(DIR_DATASET, 'votos.json.gz'), votos);
escribirJsonGz(join(DIR_DATASET, 'votaciones.json.gz'), votaciones);
escribirJsonGz(join(DIR_DATASET, 'personas.json.gz'), personas);
escribirJsonGz(join(DIR_DATASET, 'bloques.json.gz'), bloques);
escribirJsonGz(join(DIR_DATASET, 'diputados_actuales.json.gz'), diputados);
escribirJsonGz(join(DIR_DATASET, 'historial_bloques.json.gz'), historial);
escribirCsv(join(DIR_DATASET, 'votos.csv.gz'), votos);
writeFileSync(
  join(DIR_DATASET, 'limpieza.json'),
  JSON.stringify(
    { ...informe, fuente: meta.fuente, datos_al: meta.stats_sitio?.last_updated },
    null,
    2,
  ),
);

const temas = votaciones.reduce((m, v) => ((m[v.tema] = (m[v.tema] ?? 0) + 1), m), {});
console.log({
  votaciones: votaciones.length,
  votos: votos.length,
  personas: personas.length,
  diputados: diputados.length,
  historial: historial.length,
  temas,
});
console.log(JSON.stringify(informe.problemas, null, 1).slice(0, 4000));
