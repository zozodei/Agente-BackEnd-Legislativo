// Análisis puro del texto de un proyecto o votación: tema, tipo y origen.
// Lo usan el entrenamiento (scripts/modelo) y la API, para que las features sean idénticas.

/** Minúsculas, sin tildes ni puntuación. */
export function normalizarTexto(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Orden = prioridad: gana el primer tema con más coincidencias (empate → el primero).
export const TEMAS = [
  {
    id: 'procedimiento',
    nombre: 'Procedimiento parlamentario',
    patrones: [
      'mocion',
      'apartamiento de reglamento',
      'apartamiento del reglamento',
      'cuarto intermedio',
      'emplazamiento',
      'tratamiento sobre tablas',
      'preferencia',
      'levantar la sesion',
      'cuestion de privilegio',
      'reconsideracion',
      'insistencia',
      'vuelta a comision',
      'giro a comision',
      'sesion especial',
      'plan de labor',
    ],
  },
  {
    id: 'economia',
    nombre: 'Economía, impuestos y presupuesto',
    patrones: [
      'presupuesto',
      'impuesto',
      'tributari',
      'iva',
      'ganancias',
      '~deuda',
      'fiscal',
      'bcra',
      'banco central',
      'monetari',
      'cambiari',
      '~inversion',
      'rigi',
      'aduana',
      'arancel',
      '~financ',
      'blanqueo',
      'moratoria',
      'bienes personales',
      'coparticipacion',
      'fmi',
      '~bonos',
      'emergencia economica',
      'privatiz',
      'empresas publicas',
      'mercado de capitales',
      'monotributo',
      'contribuyente',
      'recaudacion',
      '~subsidio',
      '~tarifa',
    ],
  },
  {
    id: 'trabajo',
    nombre: 'Trabajo y previsión social',
    patrones: [
      'jubilac',
      'previsional',
      'pension',
      'trabajo',
      'laboral',
      'sindical',
      'empleo',
      'salario',
      'anses',
      'movilidad',
      'convenio colectivo',
      'trabajador',
      'indemniz',
      'aguinaldo',
      'riesgos del trabajo',
      'seguridad social',
    ],
  },
  {
    id: 'salud',
    nombre: 'Salud',
    patrones: [
      'salud',
      'medicament',
      'hospital',
      'enfermedad',
      'vacun',
      'oncolog',
      '~medic',
      'sanitari',
      'covid',
      'pandemia',
      'prepaga',
      'obra social',
      'cannabis',
      'donacion de organos',
      'trasplante',
      'salud mental',
      'fibrosis',
      'diabetes',
      'celiac',
    ],
  },
  {
    id: 'discapacidad',
    nombre: 'Discapacidad y desarrollo social',
    patrones: [
      'discapacidad',
      'alimentari',
      'asignacion universal',
      'vulnerab',
      'pobreza',
      'barrios populares',
      'desarrollo social',
      'niñez',
      'ninez',
      'adolescen',
      'infancia',
      'adultos mayores',
      'garrafa',
      'comedor',
    ],
  },
  {
    id: 'educacion',
    nombre: 'Educación, ciencia y cultura',
    patrones: [
      'educac',
      'universidad',
      'universitari',
      'escuela',
      'docente',
      'ciencia',
      'tecnolog',
      'investigacion',
      'conicet',
      'cultura',
      'cultural',
      'patrimonio',
      'museo',
      'teatro',
      'cine',
      'biblioteca',
      'deporte',
      'deportiv',
      'arte',
    ],
  },
  {
    id: 'seguridad',
    nombre: 'Seguridad y justicia penal',
    patrones: [
      'codigo penal',
      'penal',
      'delito',
      'seguridad',
      'narcotrafic',
      'crimen',
      'criminal',
      'carcel',
      'penitenciari',
      'policia',
      'fuerzas de seguridad',
      'imputabilidad',
      'terroris',
      'armas',
      'violencia',
      'reiterancia',
      'vandalismo',
      'juicio en ausencia',
      'lavado de',
    ],
  },
  {
    id: 'justicia',
    nombre: 'Justicia e instituciones',
    patrones: [
      'justicia',
      'judicial',
      'juzgado',
      'camara federal',
      'tribunal',
      'corte suprema',
      'consejo de la magistratura',
      'ministerio publico',
      'electoral',
      'elecciones',
      'paso',
      'boleta',
      'partidos politicos',
      'reforma del estado',
      'ley de ministerios',
      'dnu',
      'decreto',
      'delegacion de facultades',
      'facultades delegadas',
      'juicio politico',
      'codigo civil',
      'procesal',
      'defensoria',
      'fiscalia',
    ],
  },
  {
    id: 'derechos',
    nombre: 'Derechos humanos, género y bioética',
    patrones: [
      'derechos humanos',
      'genero',
      'mujer',
      'igualdad',
      'interrupcion voluntaria',
      'aborto',
      'matrimonio',
      'identidad',
      'memoria',
      'lesa humanidad',
      'diversidad',
      'violencia de genero',
      'paridad',
      'discrimin',
      'pueblos indigenas',
      'comunidades indigenas',
      'ley micaela',
      // bioética y familia: temas donde la Cámara suele dividirse por convicciones
      'gestacion',
      'gestante',
      'vientre',
      'subrogacion',
      'embarazo',
      'reproduccion',
      'fertilizacion',
      'muerte digna',
      'eutanasia',
      'educacion sexual',
      'union civil',
      'filiacion',
      'bioetic',
    ],
  },
  {
    id: 'ambiente',
    nombre: 'Ambiente y energía',
    patrones: [
      'ambiente',
      'ambiental',
      'glaciar',
      'bosque',
      'humedal',
      'energia',
      'energetic',
      'hidrocarburo',
      'petrol',
      'gas',
      'mineria',
      'minero',
      'litio',
      'electric',
      'nuclear',
      'renovable',
      'biocombustible',
      'clima',
      'incendio',
      'agua',
      'residuos',
    ],
  },
  {
    id: 'produccion',
    nombre: 'Producción, agro e industria',
    patrones: [
      'agro',
      'agropecuari',
      'rural',
      'ganad',
      'pesca',
      'industria',
      'pyme',
      'comercio',
      'economia del conocimiento',
      'turismo',
      'produccion',
      'productiv',
      'cooperativ',
      'vitivinic',
      'yerba',
      'tabaco',
      'semilla',
      'emprendedor',
      'consumidor',
      'alquiler',
      'inquilin',
      'propiedad privada',
    ],
  },
  {
    id: 'infraestructura',
    nombre: 'Infraestructura, transporte y comunicaciones',
    patrones: [
      'transporte',
      'ferrocarril',
      'ruta',
      'vial',
      'obra publica',
      'vivienda',
      'puerto',
      'aeronaut',
      'aerolinea',
      'telecomunicac',
      'comunicacion',
      'internet',
      'medios',
      'audiovisual',
      'correo',
      'hidrovia',
    ],
  },
  {
    id: 'exterior',
    nombre: 'Relaciones exteriores y defensa',
    patrones: [
      'tratado',
      'acuerdo',
      'convenio',
      'convencion',
      'protocolo',
      'mercosur',
      'internacional',
      'malvinas',
      'defensa',
      'fuerzas armadas',
      'tropas',
      'militar',
      'ingreso de tropas',
      'salida de tropas',
      'embajad',
      'republica de',
      'reino de',
    ],
  },
  {
    id: 'simbolico',
    nombre: 'Declaraciones, homenajes y transferencias',
    patrones: [
      'capital nacional',
      'declaracion como',
      'declarase',
      'monumento historico',
      'lugar historico',
      'homenaje',
      'dia nacional',
      'feriado',
      'transferencia a titulo gratuito',
      'transferencia de inmueble',
      'inmueble',
      'denominacion',
      'beneplacito',
      'conmemora',
      'fiesta nacional',
      'sitio historico',
      'moneda conmemorativa',
    ],
  },
];

// Un patrón con "~" es genérico (aparece en muchos temas) y suma medio punto.
const TEMAS_REGEX = TEMAS.map((t) => ({
  ...t,
  regex: t.patrones.map((p) => ({
    peso: p.startsWith('~') ? 0.5 : 1,
    re: new RegExp(`\\b${p.replace(/^~/, '').replace(/ /g, '\\s+')}`, 'g'),
  })),
}));

/** Devuelve el id del tema más probable ('otros' si nada coincide). */
export function clasificarTema(...textos) {
  const texto = normalizarTexto(textos.filter(Boolean).join(' '));
  let mejor = { id: 'otros', puntos: 0 };
  for (const t of TEMAS_REGEX) {
    let puntos = 0;
    for (const { peso, re } of t.regex) puntos += peso * (texto.match(re) ?? []).length;
    // Las mociones son procedimiento aunque nombren otro tema.
    if (t.id === 'procedimiento' && puntos > 0 && /^(mocion|apartamiento)/.test(texto)) {
      return 'procedimiento';
    }
    if (puntos > mejor.puntos) mejor = { id: t.id, puntos };
  }
  return mejor.id;
}

export function nombreTema(id) {
  return TEMAS.find((t) => t.id === id)?.nombre ?? 'Otros temas';
}

/**
 * Rasgos formales del título de una votación de la HCDN.
 * tipo: 'mocion' | 'proyecto' ; dictamen: 'mayoria' | 'minoria' | null ;
 * origenSenado: viene en revisión del Senado o vuelve con modificaciones.
 */
export function analizarTitulo(titulo) {
  const t = normalizarTexto(titulo);
  const esMocion =
    /^(mocion|apartamiento|cuestion de privilegio|reconsideracion|insistencia)/.test(t) ||
    /\b(mocion|apartamiento de reglamento)\b/.test(t);
  let dictamen = null;
  if (/dict(amen)? de may/.test(t)) dictamen = 'mayoria';
  else if (/dict(amen)? de min/.test(t)) dictamen = 'minoria';
  const origenSenado = /\b(en revision|revision|h senado|del senado)\b/.test(t);
  const poderEjecutivo = /\b(mensaje|poder ejecutivo|p e n)\b/.test(t);
  return { tipo: esMocion ? 'mocion' : 'proyecto', dictamen, origenSenado, poderEjecutivo };
}

const RE_SOLICITANTE =
  /SOLICITAD[OA]S?\s+POR\s+(?:EL|LA|LOS|LAS)?\s*(?:DIP(?:S)?\.?|DIPUTAD[OA]S?)\s+([^.]+?)(?:\.|\s+PARA\b|\s+Y\s+(?:EL|LA)\b|$)/i;

/** Apellido (y nombre si está) de quien pidió una moción, tal como aparece en el título. */
export function extraerSolicitante(titulo) {
  const m = String(titulo ?? '').match(RE_SOLICITANTE);
  if (!m) return null;
  const crudo = m[1].trim();
  const [apellido, nombre] = crudo.split(',').map((s) => normalizarTexto(s));
  if (!apellido) return null;
  return { crudo, apellido, nombre: nombre || null };
}
