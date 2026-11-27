// Arma data/modelo/historia.json.gz: historial compacto que el motor carga en memoria.
// Requiere haber corrido scripts/dataset/construir.mjs y scripts/modelo/lsa.mjs.
//   node scripts/modelo/historia.mjs
import { join } from 'node:path';
import { DIR_DATASET, DIR_MODELO, leerJsonGz, escribirJsonGz, leerRaw } from '../dataset/comun.mjs';
import { COD, diaDe } from '../../src/prediccion/historia.js';

const votaciones = leerJsonGz(join(DIR_DATASET, 'votaciones.json.gz'));
const votos = leerJsonGz(join(DIR_DATASET, 'votos.json.gz'));
const personas = leerJsonGz(join(DIR_DATASET, 'personas.json.gz'));
const bloques = leerJsonGz(join(DIR_DATASET, 'bloques.json.gz'));
const embeddings = leerJsonGz(join(DIR_MODELO, 'embeddings_lsa.json.gz'));
const meta = Object.fromEntries(leerRaw('cv_meta').map((m) => [m.clave, m.valor]));

const indicePersona = new Map(personas.map((p, i) => [p.id, i]));
const provincias = [...new Set(votos.map((v) => v.provincia).filter(Boolean))].sort();
const indiceProvincia = new Map(provincias.map((p, i) => [p, i]));

const porVotacion = new Map();
for (const v of votos) {
  if (!porVotacion.has(v.votacion_id)) porVotacion.set(v.votacion_id, []);
  porVotacion.get(v.votacion_id).push(v);
}

const historia = {
  meta: {
    generado: new Date().toISOString(),
    fuente: meta.fuente,
    datosAl: meta.stats_sitio?.last_updated ?? null,
    votaciones: votaciones.length,
    votos: votos.length,
  },
  bloques: Object.fromEntries(bloques.map((b) => [b.grupo_id, b.grupo_nombre])),
  provincias,
  personas: personas.map((p) => ({ id: p.id, nombre: p.nombre })),
  votaciones: votaciones.map((v) => ({
    id: v.id,
    fecha: v.fecha.slice(0, 10),
    dia: diaDe(v.fecha),
    titulo: v.titulo,
    nombreLey: v.nombre_ley,
    leyId: v.ley_id,
    esGeneral: v.es_general,
    tipo: v.tipo,
    dictamen: v.dictamen,
    origenSenado: v.origen_senado,
    tema: v.tema,
    resultado: v.resultado,
    ofi: v.postura_oficialismo ? COD[v.postura_oficialismo] : -1,
    solicitantePersona: v.solicitante_persona_id
      ? indicePersona.get(v.solicitante_persona_id)
      : null,
    url: v.url_acta,
    conteo: [v.afirmativos, v.negativos, v.abstenciones, v.ausentes],
    emb: embeddings[v.id],
  })),
  votos: votaciones.map((v) => {
    const lista = (porVotacion.get(v.id) ?? [])
      .map((x) => [
        indicePersona.get(x.persona_id),
        COD[x.voto],
        x.bloque_grupo_id,
        indiceProvincia.get(x.provincia) ?? -1,
      ])
      .sort((a, b) => a[0] - b[0]);
    return {
      p: lista.map((x) => x[0]),
      v: lista.map((x) => x[1]).join(''),
      g: lista.map((x) => x[2]),
      pr: lista.map((x) => x[3]),
    };
  }),
};
escribirJsonGz(join(DIR_MODELO, 'historia.json.gz'), historia);
console.log(
  'historia:',
  historia.votaciones.length,
  'votaciones,',
  votos.length,
  'votos,',
  personas.length,
  'personas',
);
