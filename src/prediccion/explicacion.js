// Explicación de cada predicción a partir de los factores estructurados (sin inventar nada):
// cada oración cita un dato que está en `factores`. Mismo criterio y tono para todos los bloques.

const VOTO_TEXTO = {
  AFIRMATIVO: 'afirmativo',
  NEGATIVO: 'negativo',
  ABSTENCION: 'abstención',
  AUSENTE: 'ausente',
};
const VOTO_VERBO = {
  AFIRMATIVO: 'votó a favor',
  NEGATIVO: 'votó en contra',
  ABSTENCION: 'se abstuvo',
  AUSENTE: 'estuvo ausente',
};

const VERBO_GRUPO = {
  AFIRMATIVO: 'votaron a favor',
  NEGATIVO: 'votaron en contra',
  ABSTENCION: 'se abstuvieron',
  AUSENTE: 'estuvieron ausentes',
};

const pct = (x) => `${Math.round(x * 100)} %`;

const SIGLAS = new Set([
  'ucr',
  'pro',
  'mid',
  'cc',
  'ari',
  'fit',
  'pts',
  'lla',
  'caba',
  'mpn',
  'pj',
]);
const MENORES = new Set([
  'de',
  'del',
  'la',
  'las',
  'los',
  'el',
  'y',
  'e',
  'por',
  'para',
  'en',
  'a',
]);

/** "UNIÓN POR LA PATRIA" → "Unión por la Patria"; respeta siglas (UCR, PRO, MID). */
export function nombreBloque(nombre) {
  const t = String(nombre ?? '').trim();
  if (!t || t !== t.toUpperCase()) return t;
  return t
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w, i) => {
      const base = w.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (SIGLAS.has(base)) return w.toUpperCase();
      if (i > 0 && MENORES.has(base)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join('');
}

export function fechaCorta(iso) {
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${Number(d)}/${Number(m)}/${a}`;
}

export function tituloCorto(titulo, max = 70) {
  const t = String(titulo ?? '')
    .replace(/^O\.\s?D\.\s?\d+\s*-\s*/i, '')
    .replace(/^(Exp(te)?\.?|Expedientes?)\s*[\w-]+\s*-\s*/i, '')
    .replace(/\s*(DICT\.|DICTAMEN|VOT\.|VOTACI[OÓ]N).*$/i, '')
    // sin puntos internos: el título citado no debe partir la oración
    .replace(/\.\s+/g, ', ')
    .replace(/\.$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const base = t || String(titulo ?? '');
  const lindo = base === base.toUpperCase() ? base.charAt(0) + base.slice(1).toLowerCase() : base;
  return lindo.length > max ? `${lindo.slice(0, max - 1).trimEnd()}…` : lindo;
}

/**
 * @param {object} f  factores de la predicción (ver motor.js → construirFactores)
 * @returns {string} 2 a 4 oraciones
 */
export function explicarConPlantilla(f) {
  const oraciones = [];
  const voto = f.prediccion.voto;
  oraciones.push(
    `Se estima ${VOTO_TEXTO[voto]} con una probabilidad del ${pct(f.prediccion.probabilidades[voto])}.`,
  );

  // 1) Votos propios en proyectos parecidos o, si no hay, en votaciones divididas del mismo tema
  const propios = f.similares.filter((s) => s.voto);
  const delTema = (f.divididasDelTema ?? []).filter((s) => s.voto);
  if (f.antecedentes?.sinAntecedentes && delTema.length) {
    const mismos = delTema.filter((s) => s.voto === voto);
    const ej = mismos[0] ?? delTema[0];
    oraciones.push(
      `No hay votaciones muy parecidas a este proyecto; en las ${delTema.length} votaciones divididas del mismo tema en las que participó, ${mismos.length ? `${VOTO_VERBO[voto]} en ${mismos.length}` : `no ${VOTO_VERBO[voto]} en ninguna`}, como en «${tituloCorto(ej.titulo)}» (${fechaCorta(ej.fecha)}, ${VOTO_TEXTO[ej.voto]}).`,
    );
  } else if (f.antecedentes?.sinAntecedentes) {
    oraciones.push(
      'No hay votaciones parecidas a este proyecto ni votaciones divididas del mismo tema en las que haya participado, así que la estimación se apoya en su comportamiento general y es poco firme.',
    );
  } else if (propios.length >= 2) {
    const mismos = propios.filter((s) => s.voto === voto);
    const ej = mismos[0] ?? propios[0];
    const cuenta = mismos.length
      ? `${VOTO_VERBO[voto]} en ${mismos.length} de ${propios.length}`
      : `no ${VOTO_VERBO[voto]} en ninguna de ${propios.length}`;
    oraciones.push(
      `En las ${propios.length} votaciones parecidas en las que participó, ${cuenta}, como en «${tituloCorto(ej.titulo)}» (${fechaCorta(ej.fecha)}, ${VOTO_TEXTO[ej.voto]}).`,
    );
  } else if (propios.length === 1) {
    const ej = propios[0];
    oraciones.push(
      `Participó en una sola votación parecida: «${tituloCorto(ej.titulo)}» (${fechaCorta(ej.fecha)}), donde su voto fue ${VOTO_TEXTO[ej.voto]}.`,
    );
  } else {
    oraciones.push(
      'No participó en votaciones parecidas a este proyecto, así que la estimación se apoya sobre todo en su bloque y su historial general.',
    );
  }

  // 2) Bloque (supuesto declarado > votos del bloque en parecidas > disciplina)
  const b = f.bloque;
  const bloque = nombreBloque(b.nombre);
  if (f.supuestos?.bloque) {
    oraciones.push(
      `El escenario supone que su bloque (${bloque}) vota ${VOTO_TEXTO[f.supuestos.bloque]}, y acompañó la postura mayoritaria de su bloque en el ${pct(f.disciplina.porcentaje)} de sus votaciones de los últimos dos años.`,
    );
  } else if (b.cobertura > 0.3) {
    const [claseBloque, valor] = Object.entries(b.enSimilares).sort((x, y) => y[1] - x[1])[0];
    let texto = `En esos casos parecidos, los integrantes actuales de su bloque (${bloque}) ${VERBO_GRUPO[claseBloque]} en el ${pct(valor)} de las veces`;
    if (claseBloque !== voto)
      texto += ', una postura distinta de la estimada para este diputado o diputada';
    else if (f.disciplina.base >= 10)
      texto += `, y acompañó la postura mayoritaria de su bloque en el ${pct(f.disciplina.porcentaje)} de sus votaciones de los últimos dos años`;
    oraciones.push(`${texto}.`);
  } else if (f.disciplina.base >= 10) {
    oraciones.push(
      `Acompañó la postura mayoritaria de su bloque (${bloque}) en el ${pct(f.disciplina.porcentaje)} de sus votaciones de los últimos dos años.`,
    );
  }

  if (f.supuestos?.comoTemaDividido && oraciones.length < 4) {
    oraciones.push(
      'El escenario supone que este proyecto se vota como las votaciones divididas del mismo tema.',
    );
  }

  // 3) Datos escasos, ausentismo u oficialismo (lo más relevante)
  if (f.datos.pocosDatos) {
    oraciones.push(
      `Tiene solo ${f.datos.votacionesUltimosDosAnios} votaciones registradas en los últimos dos años, por eso la confianza de esta estimación es baja.`,
    );
  } else if (voto === 'AUSENTE' || f.ausentismo.ultimas10 >= 4) {
    oraciones.push(
      `Estuvo ausente en ${f.ausentismo.ultimas10} de sus últimas ${f.ausentismo.registradas} votaciones registradas.`,
    );
  } else if (f.supuestos?.oficialismo && f.oficialismo.base >= 20) {
    oraciones.push(
      `El escenario supone que el oficialismo vota ${VOTO_TEXTO[f.supuestos.oficialismo]}; en los últimos dos años coincidió con la postura del oficialismo en el ${pct(f.oficialismo.alineacion)} de sus votaciones.`,
    );
  } else if (f.oficialismo.base >= 20 && oraciones.length < 4) {
    oraciones.push(
      `En los últimos dos años coincidió con la postura mayoritaria del oficialismo en el ${pct(f.oficialismo.alineacion)} de sus votaciones.`,
    );
  }
  return oraciones.slice(0, 4).join(' ');
}
