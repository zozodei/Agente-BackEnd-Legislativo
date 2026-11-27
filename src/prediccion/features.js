// Features del modelo para (proyecto, diputado). El mismo código se usa para entrenar con
// votaciones pasadas y para predecir un proyecto nuevo: solo cambia de dónde salen los sujetos.
// Regla anti-fuga: todo se calcula con votaciones de días ANTERIORES a `ctx.dia`.
import { CLASES, COD, mayoriaDe } from './historia.js';
import { similitud } from './similitud.js';
import { TEMAS, normalizarTexto } from './proyecto.js';
import { esBloqueOficialista } from './gobiernos.js';

export const VENTANA_LARGA = 730; // días
export const VENTANA_CORTA = 180;
export const VENTANA_RECIENTES = 1461; // vecinos "recientes": últimos 4 años
export const K_VECINOS = 10;
const PRIOR_GLOBAL = [0.56, 0.18, 0.02, 0.24];
const EPS = 0.02;
const TAU = 0.3;

const TEMAS_IDS = [...TEMAS.map((t) => t.id), 'otros'];

export const NOMBRES_FEATURES = [
  // votaciones parecidas (todas las épocas)
  'dep_sim_A',
  'dep_sim_N',
  'dep_sim_B',
  'dep_sim_U',
  'dep_sim_cob',
  'blo_sim_A',
  'blo_sim_N',
  'blo_sim_B',
  'blo_sim_U',
  'blo_sim_cohesion',
  'blo_sim_cob',
  'cam_sim_A',
  'cam_sim_N',
  'cam_sim_U',
  'cam_sim_unanime',
  'prov_sim_A',
  'prov_sim_N',
  'ofi_sim_A',
  'ofi_sim_N',
  'sim_max',
  'sim_media',
  // votaciones parecidas de los últimos 4 años
  'rec_dep_A',
  'rec_dep_N',
  'rec_dep_U',
  'rec_dep_cob',
  'rec_blo_A',
  'rec_blo_N',
  'rec_blo_U',
  'rec_blo_cob',
  'rec_sim_max',
  // la votación reciente más parecida (p. ej. la misma ley antes de un veto o del Senado)
  'top_dep_A',
  'top_dep_N',
  'top_dep_U',
  'top_blo_A',
  'top_blo_N',
  'x_top_dep',
  'x_top_blo',
  // votaciones DIVIDIDAS del mismo tema (antecedente por convicción cuando no hay ley parecida)
  'tema_dep_A',
  'tema_dep_N',
  'tema_dep_cob',
  'tema_blo_A',
  'tema_blo_N',
  'tema_blo_cob',
  'n_tema_div',
  'falta_precedente',
  'x_falta_tema_dep',
  'x_falta_tema_blo',
  // historial propio y del bloque
  'dep_base_A',
  'dep_base_N',
  'dep_base_B',
  'dep_base_U',
  'dep_aus_180',
  'dep_aus_ult10',
  'disciplina',
  'alin_ofi_dep',
  'alin_ofi_blo',
  'es_oficialista',
  'experiencia',
  'nuevo',
  'blo_tam',
  // rasgos del proyecto
  'es_mocion',
  'dict_mayoria',
  'dict_minoria',
  'origen_senado',
  'es_general',
  'tiene_solicitante',
  'misma_bancada_solicitante',
  'acuerdo_solicitante',
  // interacciones
  'x_ofi_alin',
  'x_mocion_ofi',
  'x_solicitante',
  'x_bloque_disciplina',
  'x_dict_ofi',
  'x_dict_alin',
  'x_senado_alin',
  'x_rec_bloque_disciplina',
  // supuestos del escenario (0 si el usuario no declara nada)
  'decl_ofi',
  'x_decl_ofi_alin',
  'x_decl_ofi_ofi',
  'decl_bloque_A',
  'decl_bloque_N',
  'decl_bloque_B',
  'x_decl_bloque_disc',
  // log-probabilidades (ayudan a la logística a combinar distribuciones)
  'ln_dep_sim_A',
  'ln_dep_sim_N',
  'ln_dep_sim_B',
  'ln_dep_sim_U',
  'ln_blo_sim_A',
  'ln_blo_sim_N',
  'ln_blo_sim_B',
  'ln_blo_sim_U',
  'ln_rec_blo_A',
  'ln_rec_blo_N',
  ...TEMAS_IDS.map((t) => `tema_${t}`),
];
export const N_FEATURES = NOMBRES_FEATURES.length;

/**
 * Votaciones más parecidas en [desdeDia, dia) (una por ley: la de mayor similitud,
 * prefiriendo la votación "en general").
 */
export const K_TEMA = 8;
const SIN_TEMA = new Set(['otros', 'procedimiento']);

/**
 * Las votaciones "en general" más recientes del mismo tema en las que la Cámara se dividió
 * (≥ 20 % de negativos entre afirmativos y negativos), de los últimos 16 años.
 */
export function buscarDivididasDelTema(historia, tema, dia, k = K_TEMA) {
  if (!tema || SIN_TEMA.has(tema)) return [];
  const desde = dia - 16 * 365;
  const salida = [];
  for (let iv = historia.primeraDesde(dia) - 1; iv >= 0 && salida.length < k; iv--) {
    const v = historia.votaciones[iv];
    if (v.dia < desde) break;
    if (v.tema !== tema || !v.esGeneral || v.tipo !== 'proyecto') continue;
    const [a, n] = v.conteo;
    if (a + n >= 100 && n >= 0.2 * (a + n)) salida.push({ iv, sim: 1 });
  }
  return salida;
}

export function buscarVecinos(historia, rep, dia, k = K_VECINOS, desdeDia = -Infinity) {
  if (!rep) return [];
  const desde = Number.isFinite(desdeDia) ? historia.primeraDesde(desdeDia) : 0;
  const limite = historia.primeraDesde(dia);
  const mejores = new Map();
  for (let iv = desde; iv < limite; iv++) {
    const v = historia.votaciones[iv];
    if (!v.emb) continue;
    const sim = similitud(rep, v.emb);
    if (sim <= 0.05) continue;
    const clave = v.leyId ?? `v${v.id}`;
    const actual = mejores.get(clave);
    const puntaje = sim + (v.esGeneral ? 0.01 : 0);
    if (!actual || puntaje > actual.puntaje) mejores.set(clave, { iv, sim, puntaje });
  }
  return [...mejores.values()]
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, k)
    .map(({ iv, sim }) => ({ iv, sim }));
}

function distribucion(codigos) {
  const d = [0, 0, 0, 0];
  let n = 0;
  for (const c of codigos) {
    if ((c ?? null) === null || c > 3) continue;
    d[c]++;
    n++;
  }
  return n ? d.map((x) => x / n) : null;
}

const suavizar = (conteo, total, prior, alfa) =>
  conteo.map((c, i) => (c + alfa * prior[i]) / (total + alfa));
/**
 * Peso de cada votación parecida: similitud^POTENCIA × decaimiento por antigüedad (vida media en
 * años). Una votación del mismo tema de este año dice más sobre los diputados actuales que una
 * de hace 20 años. Configurable por entorno para el backtesting (POROTEO_POTENCIA / POROTEO_VIDA).
 */
export const PESOS = {
  potencia: Number(process.env.POROTEO_POTENCIA ?? 2),
  vidaMediaAnios: Number(process.env.POROTEO_VIDA ?? 4),
};
const pesosDe = (historia, vecinos, dia) =>
  vecinos.map((x) => {
    const anios = (dia - historia.votaciones[x.iv].dia) / 365.25;
    return Math.max(x.sim, 0) ** PESOS.potencia * 0.5 ** (anios / PESOS.vidaMediaAnios);
  });

/** Distribución de votos de un conjunto de personas en un conjunto de vecinos. */
function distribucionGrupo(historia, miembros, vecinos, pesos, prior) {
  const suma = pesos.reduce((s, w) => s + w, 0) || 1;
  const acc = [0, 0, 0, 0];
  let coh = 0;
  let pesoPresente = 0;
  const porVecino = vecinos.map(({ iv }, j) => {
    const cods = miembros.map((p) => (p >= 0 ? historia.votoEn(iv, p) : null));
    const d = distribucion(cods);
    if (!d) return null;
    for (let c = 0; c < 4; c++) acc[c] += pesos[j] * d[c];
    const presentes = d[0] + d[1] + d[2];
    if (presentes > 0) coh += pesos[j] * (Math.max(d[0], d[1], d[2]) / presentes);
    pesoPresente += pesos[j];
    return {
      mayoria: mayoriaDe(cods),
      d,
      presentes: cods.filter((c) => (c ?? null) !== null && c <= 3).length,
    };
  });
  return {
    dist: acc.map((x, c) => (x + TAU * prior[c]) / (pesoPresente + TAU)),
    cohesion: pesoPresente ? coh / pesoPresente : 0.8,
    cobertura: pesoPresente / suma,
    porVecino,
  };
}

/**
 * @param {import('./historia.js').Historia} historia
 * @param {object} ctx  { dia, rep, tipo, dictamen, origenSenado, esGeneral, tema,
 *   solicitante: { persona, grupo } | null,
 *   posturaOficialismo: 0 (A) | 1 (N) | null,        ← supuesto opcional del escenario
 *   posturasBloque: Map<grupo, 0|1|2> | null,         ← supuestos opcionales por bloque
 *   vecinos?, vecinosRecientes? }
 * @param {Array<{persona:number, grupo:string|number, bloqueNombre:string, provincia:number}>} sujetos
 */
export function calcularFeatures(historia, ctx, sujetos) {
  const dia = ctx.dia;
  const desdeLarga = dia - VENTANA_LARGA;
  const desdeCorta = dia - VENTANA_CORTA;
  const vecinos = ctx.vecinos ?? buscarVecinos(historia, ctx.rep, dia);
  const recientes =
    ctx.vecinosRecientes ??
    buscarVecinos(historia, ctx.rep, dia, K_VECINOS, dia - VENTANA_RECIENTES);
  const pesos = pesosDe(historia, vecinos, dia);
  const pesosRec = pesosDe(historia, recientes, dia);
  const delTema = ctx.vecinosTema ?? buscarDivididasDelTema(historia, ctx.tema, dia);
  const pesosTema = pesosDe(historia, delTema, dia);
  const sumaPesos = pesos.reduce((s, w) => s + w, 0) || 1;
  const fechaIso = new Date(dia * 86_400_000).toISOString().slice(0, 10);

  // ---- por votación vecina: cámara, provincia, oficialismo
  const cam = [0, 0, 0, 0];
  let pesoCam = 0;
  let unanime = 0;
  const ofi = [0, 0];
  let pesoOfi = 0;
  const provPorVecino = vecinos.map(({ iv }, j) => {
    const { v, pr } = historia.votos[iv];
    const d = distribucion(v);
    if (d) {
      for (let c = 0; c < 4; c++) cam[c] += pesos[j] * d[c];
      pesoCam += pesos[j];
      const presentes = d[0] + d[1] + d[2];
      if (presentes > 0 && d[1] / presentes < 0.05) unanime += pesos[j];
    }
    const o = historia.votaciones[iv].ofi;
    if (o === 0 || o === 1) {
      ofi[o] += pesos[j];
      pesoOfi += pesos[j];
    }
    const porProv = new Map();
    for (let i = 0; i < v.length; i++) {
      if (v[i] > 3) continue;
      if (!porProv.has(pr[i])) porProv.set(pr[i], [0, 0, 0, 0]);
      porProv.get(pr[i])[v[i]]++;
    }
    return porProv;
  });
  const camSim = pesoCam ? cam.map((x) => x / pesoCam) : PRIOR_GLOBAL;
  const ofiSim = pesoOfi ? [ofi[0] / pesoOfi, ofi[1] / pesoOfi] : [0.5, 0.5];
  const simMax = vecinos[0]?.sim ?? 0;
  // 1 = ninguna votación realmente parecida (similitud ≤ 0,10); 0 = hay una muy parecida (≥ 0,45)
  const faltaPrecedente = Math.min(1, Math.max(0, (0.45 - simMax) / 0.35));
  const simMedia = vecinos.length ? vecinos.reduce((s, x) => s + x.sim, 0) / vecinos.length : 0;

  // ---- resúmenes por persona
  const resumenes = sujetos.map((s) => ({
    larga: historia.resumenPersona(s.persona, desdeLarga, dia),
    corta: historia.resumenPersona(s.persona, desdeCorta, dia),
    ult10: historia.ultimos(s.persona, dia, 10),
  }));
  const baseDe = (r) =>
    r?.larga ? suavizar(r.larga.conteo, r.larga.total, PRIOR_GLOBAL, 5) : PRIOR_GLOBAL;
  const alinOfi = (r) => (r?.larga ? (r.larga.ofiSi + 3) / (r.larga.ofiBase + 6) : 0.5);

  // ---- por bloque (integrantes actuales del bloque del sujeto)
  const bloques = new Map();
  sujetos.forEach((s, i) => {
    if (!bloques.has(s.grupo)) bloques.set(s.grupo, { miembros: [], indices: [] });
    bloques.get(s.grupo).miembros.push(s.persona);
    bloques.get(s.grupo).indices.push(i);
  });
  const infoBloque = new Map();
  for (const [grupo, b] of bloques) {
    const base = [0, 0, 0, 0];
    let alin = 0;
    for (const i of b.indices) {
      const bd = baseDe(resumenes[i]);
      for (let c = 0; c < 4; c++) base[c] += bd[c] / b.indices.length;
      alin += alinOfi(resumenes[i]) / b.indices.length;
    }
    const todo = distribucionGrupo(historia, b.miembros, vecinos, pesos, base);
    const rec = distribucionGrupo(historia, b.miembros, recientes, pesosRec, base);
    const tema = distribucionGrupo(historia, b.miembros, delTema, pesosTema, base);
    infoBloque.set(grupo, { todo, rec, tema, alinOfi: alin, tam: b.indices.length });
  }

  // ---- solicitante (mociones): acuerdo histórico entre cada bloque y el bloque de quien la pide
  let acuerdos = null;
  const sol = ctx.solicitante;
  if (sol && (sol.grupo ?? null) !== null && bloques.has(sol.grupo)) {
    acuerdos = new Map();
    const miembrosSol = bloques.get(sol.grupo).miembros;
    const desde = historia.primeraDesde(desdeLarga);
    const hasta = historia.primeraDesde(dia);
    const ivs = [];
    for (let iv = Math.max(desde, hasta - 150); iv < hasta; iv++) ivs.push(iv);
    const mayoriaGrupo = (miembros, iv) =>
      mayoriaDe(miembros.map((p) => (p >= 0 ? historia.votoEn(iv, p) : null)));
    const maySol = ivs.map((iv) => mayoriaGrupo(miembrosSol, iv));
    for (const [grupo, b] of bloques) {
      let si = 0;
      let base = 0;
      ivs.forEach((iv, k) => {
        if ((maySol[k] ?? null) === null) return;
        const m = mayoriaGrupo(b.miembros, iv);
        if ((m ?? null) === null) return;
        base++;
        if (m === maySol[k]) si++;
      });
      acuerdos.set(grupo, grupo === sol.grupo ? 1 : (si + 1) / (base + 2));
    }
  }

  const esMocion = ctx.tipo === 'mocion' ? 1 : 0;
  const dictMay = ctx.dictamen === 'mayoria' ? 1 : 0;
  const senado = ctx.origenSenado ? 1 : 0;
  const declOfi = ctx.posturaOficialismo === 0 ? 1 : ctx.posturaOficialismo === 1 ? -1 : 0;
  const temaOneHot = TEMAS_IDS.map((t) => (t === (ctx.tema ?? 'otros') ? 1 : 0));

  const X = [];
  const detalles = [];
  sujetos.forEach((s, i) => {
    const r = resumenes[i];
    const base = baseDe(r);
    const b = infoBloque.get(s.grupo);
    // Sin votos propios en parecidas, lo más informativo es cómo votó su bloque en esas mismas
    // votaciones: el prior mezcla esa distribución (70 %) con su historial general (30 %).
    const propio = (lista, ps, distBloque) => {
      const prior = distBloque.map((x, c) => 0.7 * x + 0.3 * base[c]);
      const acc = [0, 0, 0, 0];
      let peso = 0;
      const votos = lista.map(({ iv, sim }, j) => {
        const c = s.persona >= 0 ? historia.votoEn(iv, s.persona) : null;
        const presente = (c ?? null) !== null && c <= 3;
        if (presente) {
          acc[c] += ps[j];
          peso += ps[j];
        }
        return { iv, sim, voto: presente ? c : null };
      });
      const suma = ps.reduce((x, w) => x + w, 0) || 1;
      return {
        dist: acc.map((x, c) => (x + TAU * prior[c]) / (peso + TAU)),
        cobertura: peso / suma,
        votos,
      };
    };
    const dep = propio(vecinos, pesos, b.todo.dist);
    const depRec = propio(recientes, pesosRec, b.rec.dist);
    const depTema = propio(delTema, pesosTema, b.tema.dist);
    dep.votos.forEach((x, j) => (x.bloque = b.todo.porVecino[j]?.mayoria ?? null));
    depRec.votos.forEach((x, j) => (x.bloque = b.rec.porVecino[j]?.mayoria ?? null));

    // provincia (sin contar al propio diputado)
    const prov = [0, 0, 0, 0];
    let pesoProv = 0;
    provPorVecino.forEach((porProv, j) => {
      const cnt = porProv.get(s.provincia);
      if (!cnt) return;
      const c = cnt.slice();
      const suyo = dep.votos[j].voto;
      if ((suyo ?? null) !== null) c[suyo] = Math.max(0, c[suyo] - 1);
      const n = c[0] + c[1] + c[2] + c[3];
      if (!n) return;
      for (let k = 0; k < 4; k++) prov[k] += (pesos[j] * c[k]) / n;
      pesoProv += pesos[j];
    });
    const provSim = pesoProv ? prov.map((x) => x / pesoProv) : camSim;

    const totalLarga = r.larga?.total ?? 0;
    const ausCorta = r.corta?.total ? (r.corta.conteo[3] + 1) / (r.corta.total + 4) : base[3];
    const ausUlt10 = r.ult10.length
      ? r.ult10.filter((c) => c === COD.AUSENTE).length / r.ult10.length
      : base[3];
    const disciplina = r.larga ? (r.larga.bloqueSi + 8.5) / (r.larga.bloqueBase + 10) : 0.85;
    const alinDep = alinOfi(r);
    const signoAlin = 2 * alinDep - 1;
    const oficialista = esBloqueOficialista(normalizarTexto(s.bloqueNombre), fechaIso) ? 1 : 0;
    const signoOfi = 2 * oficialista - 1;
    const tieneSol = acuerdos ? 1 : 0;
    const mismaBancada = acuerdos && s.grupo === sol.grupo ? 1 : 0;
    const acuerdo = acuerdos ? acuerdos.get(s.grupo) : 0.5;
    const declBloque = ctx.posturasBloque?.get(s.grupo);
    const declB = [0, 1, 2].map((c) => (declBloque === c ? 1 : 0));

    const topSim2 = (recientes[0]?.sim ?? 0) ** 2;
    const f = [
      ...dep.dist,
      dep.cobertura,
      ...b.todo.dist,
      b.todo.cohesion,
      b.todo.cobertura,
      camSim[0],
      camSim[1],
      camSim[3],
      unanime / sumaPesos,
      provSim[0],
      provSim[1],
      ofiSim[0],
      ofiSim[1],
      simMax,
      simMedia,
      depRec.dist[0],
      depRec.dist[1],
      depRec.dist[3],
      depRec.cobertura,
      b.rec.dist[0],
      b.rec.dist[1],
      b.rec.dist[3],
      b.rec.cobertura,
      recientes[0]?.sim ?? 0,
      ...[0, 1, 3].map((c) => (depRec.votos[0]?.voto === c ? 1 : 0)),
      b.rec.porVecino[0]?.d[0] ?? 0,
      b.rec.porVecino[0]?.d[1] ?? 0,
      topSim2 * ((depRec.votos[0]?.voto === 0 ? 1 : 0) - (depRec.votos[0]?.voto === 1 ? 1 : 0)),
      topSim2 * ((b.rec.porVecino[0]?.d[0] ?? 0) - (b.rec.porVecino[0]?.d[1] ?? 0)),
      depTema.dist[0],
      depTema.dist[1],
      depTema.cobertura,
      b.tema.dist[0],
      b.tema.dist[1],
      b.tema.cobertura,
      delTema.length / K_TEMA,
      faltaPrecedente,
      faltaPrecedente * (depTema.dist[0] - depTema.dist[1]),
      faltaPrecedente * (b.tema.dist[0] - b.tema.dist[1]),
      ...base,
      ausCorta,
      ausUlt10,
      disciplina,
      alinDep,
      b.alinOfi,
      oficialista,
      Math.log1p(totalLarga) / Math.log(500),
      totalLarga < 20 ? 1 : 0,
      Math.log1p(b.tam) / Math.log(130),
      esMocion,
      dictMay,
      ctx.dictamen === 'minoria' ? 1 : 0,
      senado,
      ctx.esGeneral ? 1 : 0,
      tieneSol,
      mismaBancada,
      acuerdo,
      (ofiSim[0] - ofiSim[1]) * signoAlin,
      esMocion * signoOfi,
      tieneSol * (2 * acuerdo - 1),
      (b.todo.dist[0] - b.todo.dist[1]) * disciplina,
      dictMay * signoOfi,
      dictMay * signoAlin,
      senado * signoAlin,
      (b.rec.dist[0] - b.rec.dist[1]) * disciplina,
      declOfi,
      declOfi * signoAlin,
      declOfi * signoOfi,
      ...declB,
      (declB[0] - declB[1]) * disciplina,
      ...dep.dist.map((x) => Math.log(x + EPS)),
      ...b.todo.dist.map((x) => Math.log(x + EPS)),
      Math.log(b.rec.dist[0] + EPS),
      Math.log(b.rec.dist[1] + EPS),
      ...temaOneHot,
    ];
    X.push(Float64Array.from(f));
    detalles.push({
      votosEnSimilares: dep.votos,
      votosEnRecientes: depRec.votos,
      temaDist: depTema.dist,
      votosEnTema: depTema.votos.map((x, j) => ({
        ...x,
        bloque: b.tema.porVecino[j]?.mayoria ?? null,
      })),
      faltaPrecedente,
      depSim: dep.dist,
      bloqueSim: b.todo.dist,
      bloqueRecientes: b.rec.dist,
      bloqueCobertura: b.todo.cobertura,
      bloqueCohesion: b.todo.cohesion,
      bloqueTam: b.tam,
      provinciaSim: provSim,
      base,
      totalVentana: totalLarga,
      conteoVentana: r.larga?.conteo ?? [0, 0, 0, 0],
      ausentismoReciente: ausCorta,
      ausentesUltimas10: r.ult10.filter((c) => c === COD.AUSENTE).length,
      ultimasRegistradas: r.ult10.length,
      disciplina,
      disciplinaBase: r.larga?.bloqueBase ?? 0,
      alineacionOficialismo: alinDep,
      alineacionOficialismoBase: r.larga?.ofiBase ?? 0,
      oficialista,
      acuerdoSolicitante: acuerdos ? acuerdo : null,
      mismaBancadaSolicitante: mismaBancada,
      posturaDeclaradaBloque: declBloque ?? null,
    });
  });
  return { X, detalles, vecinos, recientes, delTema, simMax, faltaPrecedente, camSim, ofiSim };
}

export { CLASES };
