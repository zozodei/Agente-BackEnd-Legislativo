/** Constantes de dominio de la Cámara de Diputados. */
export const DIPUTADOS_TOTAL = 257;
export const QUORUM_DIPUTADOS = 129;

/** Votos posibles en las votaciones reales (cv_votos). */
export const VOTOS_REALES = ['AFIRMATIVO', 'NEGATIVO', 'ABSTENCION', 'AUSENTE', 'PRESIDENTE'];

/** Votos posibles en un poroteo. */
export const VOTOS_POROTEO = ['AFIRMATIVO', 'NEGATIVO', 'ABSTENCION', 'AUSENTE', 'INDEFINIDO'];

/** Tipos de mayoría soportados por el cálculo del poroteo. */
export const TIPOS_MAYORIA = ['simple', 'absoluta', 'dos_tercios'];

/** Resultados "limpios" de una votación (algunos registros traen números raros). */
export const RESULTADOS_VALIDOS = ['AFIRMATIVO', 'NEGATIVO', 'EMPATE'];

/** Límite de filas por request de PostgREST. */
export const POSTGREST_MAX_ROWS = 1000;

/** Fuente de los datos: hay que citarla en la plataforma. */
export const FUENTE_DATOS = {
  nombre: '¿Cómo Votó?',
  autor: 'Rodrigo Quiroga',
  sitio: 'https://comovoto.dev.ar',
  repo: 'https://github.com/rquiroga7/Como_voto',
};
