// Índice en memoria del historial de votaciones, construido desde el artefacto
// data/modelo/historia.json.gz. Permite consultar, para cualquier fecha de corte, tasas por
// persona (presentismo, disciplina, alineación con el oficialismo) en O(log n) con sumas acumuladas.

/** Códigos de voto en el artefacto. */
export const COD = { AFIRMATIVO: 0, NEGATIVO: 1, ABSTENCION: 2, AUSENTE: 3, PRESIDENTE: 4 };
export const CLASES = ['AFIRMATIVO', 'NEGATIVO', 'ABSTENCION', 'AUSENTE'];
export const DIA_MS = 86_400_000;

export function diaDe(fecha) {
  return Math.floor(Date.parse(String(fecha).slice(0, 10) + 'T00:00:00Z') / DIA_MS);
}

/** Mayoría entre presentes (A/N/Abst) de un conjunto de códigos; null si no hay presentes o empate. */
export function mayoriaDe(codigos) {
  const c = [0, 0, 0];
  for (const x of codigos) if (x <= 2) c[x]++;
  const max = Math.max(...c);
  if (max === 0) return null;
  const ganadores = c.filter((v) => v === max).length;
  return ganadores > 1 ? null : c.indexOf(max);
}

function busquedaDia(dias, dia) {
  // primer índice con dias[i] >= dia
  let lo = 0;
  let hi = dias.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dias[mid] < dia) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class Historia {
  /** @param {object} artefacto contenido de historia.json.gz */
  constructor(artefacto) {
    this.meta = artefacto.meta;
    this.bloques = artefacto.bloques; // grupoId → nombre
    this.provincias = artefacto.provincias;
    this.personas = artefacto.personas; // [{ id, nombre }]
    this.votaciones = artefacto.votaciones; // ordenadas por fecha
    this.indicePersona = new Map(this.personas.map((p, i) => [p.id, i]));
    this.indiceVotacion = new Map(this.votaciones.map((v, i) => [v.id, i]));

    // Votos por votación: arrays paralelos (persona, código, grupo de bloque, provincia).
    this.votos = artefacto.votos.map((x) => ({
      p: Int32Array.from(x.p),
      v: Uint8Array.from(x.v, (ch) => Number(ch)),
      g: Int32Array.from(x.g),
      pr: Int16Array.from(x.pr),
    }));
    this.diasVotacion = Int32Array.from(this.votaciones, (v) => v.dia);

    // Mayoría de cada bloque en cada votación (ignorando bloques de 1 presente).
    this.mayoriaBloque = this.votos.map(({ v, g }) => {
      const por = new Map();
      for (let i = 0; i < v.length; i++) {
        if (!por.has(g[i])) por.set(g[i], []);
        por.get(g[i]).push(v[i]);
      }
      const m = new Map();
      for (const [grupo, cods] of por) {
        if (cods.filter((c) => c <= 2).length >= 2) m.set(grupo, mayoriaDe(cods));
      }
      return m;
    });

    // Línea de tiempo por persona con sumas acumuladas.
    const lineas = this.personas.map(() => []);
    this.votos.forEach(({ p, v, g }, iv) => {
      const ofi = this.votaciones[iv].ofi;
      for (let k = 0; k < p.length; k++) {
        if (v[k] === COD.PRESIDENTE) continue;
        lineas[p[k]].push([iv, v[k], g[k], ofi]);
      }
    });
    this.lineas = lineas.map((l) => this.#acumular(l));
  }

  #acumular(l) {
    const n = l.length;
    const r = {
      vot: new Int32Array(n),
      dia: new Int32Array(n),
      cod: new Uint8Array(n),
      // acumulados (longitud n + 1): por clase, coincidencias con bloque/oficialismo y sus bases
      acc: [0, 1, 2, 3].map(() => new Int32Array(n + 1)),
      accBloqueSi: new Int32Array(n + 1),
      accBloqueBase: new Int32Array(n + 1),
      accOfiSi: new Int32Array(n + 1),
      accOfiBase: new Int32Array(n + 1),
    };
    for (let i = 0; i < n; i++) {
      const [iv, cod, grupo, ofi] = l[i];
      r.vot[i] = iv;
      r.dia[i] = this.votaciones[iv].dia;
      r.cod[i] = cod;
      for (let c = 0; c < 4; c++) r.acc[c][i + 1] = r.acc[c][i] + (cod === c ? 1 : 0);
      const mayB = this.mayoriaBloque[iv].get(grupo);
      const presente = cod <= 2;
      const baseB = presente && (mayB ?? null) !== null ? 1 : 0;
      r.accBloqueBase[i + 1] = r.accBloqueBase[i] + baseB;
      r.accBloqueSi[i + 1] = r.accBloqueSi[i] + (baseB && mayB === cod ? 1 : 0);
      const baseO = presente && (ofi ?? null) !== null && ofi >= 0 ? 1 : 0;
      r.accOfiBase[i + 1] = r.accOfiBase[i] + baseO;
      r.accOfiSi[i + 1] = r.accOfiSi[i] + (baseO && ofi === cod ? 1 : 0);
    }
    return r;
  }

  /** Rango [i, j) de la línea de una persona con votaciones en [diaDesde, diaHasta). */
  rango(persona, diaDesde, diaHasta) {
    const l = this.lineas[persona];
    return [busquedaDia(l.dia, diaDesde), busquedaDia(l.dia, diaHasta), l];
  }

  /** Conteos por clase, disciplina y alineación con el oficialismo en una ventana. */
  resumenPersona(persona, diaDesde, diaHasta) {
    if ((persona ?? null) === null || persona < 0) return null;
    const [i, j, l] = this.rango(persona, diaDesde, diaHasta);
    const conteo = [0, 1, 2, 3].map((c) => l.acc[c][j] - l.acc[c][i]);
    return {
      total: j - i,
      conteo,
      bloqueSi: l.accBloqueSi[j] - l.accBloqueSi[i],
      bloqueBase: l.accBloqueBase[j] - l.accBloqueBase[i],
      ofiSi: l.accOfiSi[j] - l.accOfiSi[i],
      ofiBase: l.accOfiBase[j] - l.accOfiBase[i],
    };
  }

  /** Últimos n códigos de voto de una persona antes de `diaHasta`. */
  ultimos(persona, diaHasta, n) {
    if ((persona ?? null) === null || persona < 0) return [];
    const l = this.lineas[persona];
    const j = busquedaDia(l.dia, diaHasta);
    return Array.from(l.cod.subarray(Math.max(0, j - n), j));
  }

  /** Voto (código) de una persona en una votación, o null si no estaba en la Cámara. */
  votoEn(iv, persona) {
    const { p, v } = this.votos[iv];
    // p está ordenado por persona en el artefacto → búsqueda binaria
    let lo = 0;
    let hi = p.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (p[mid] === persona) return v[mid];
      if (p[mid] < persona) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  /** Provincia (índice) de la última votación registrada de una persona, o -1. */
  ultimaProvincia(persona) {
    const l = persona >= 0 ? this.lineas[persona] : null;
    if (!l || !l.vot.length) return -1;
    const iv = l.vot[l.vot.length - 1];
    const { p, pr } = this.votos[iv];
    const k = p.indexOf(persona);
    return k >= 0 ? pr[k] : -1;
  }

  /** Índice de la primera votación con día >= dia. */
  primeraDesde(dia) {
    return busquedaDia(this.diasVotacion, dia);
  }
}
