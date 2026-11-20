// Presidencias de la Nación desde 1989 y el bloque oficialista en Diputados.
// Datos públicos (Casa Rosada / Boletín Oficial). `bloqueOficialista` es una expresión sobre el
// nombre normalizado del bloque (sin tildes, minúsculas) usada para identificar, en cada
// votación, a los diputados del bloque del presidente. Es una definición operativa y neutral:
// "oficialismo" = el bloque del partido del presidente en funciones, nada más.
export const GOBIERNOS = [
  {
    id: 'menem',
    presidente: 'Carlos S. Menem',
    partido: 'Partido Justicialista',
    desde: '1989-07-08',
    hasta: '1999-12-10',
    bloqueOficialista: /justicialista/,
  },
  {
    id: 'de-la-rua',
    presidente: 'Fernando de la Rúa',
    partido: 'Unión Cívica Radical (Alianza)',
    desde: '1999-12-10',
    hasta: '2001-12-21',
    bloqueOficialista: /(union civica radical|^ucr|alianza)/,
  },
  {
    id: 'transicion-2001',
    presidente: 'Ramón Puerta / Adolfo Rodríguez Saá / Eduardo Camaño',
    partido: 'Partido Justicialista',
    desde: '2001-12-21',
    hasta: '2002-01-02',
    bloqueOficialista: /justicialista/,
  },
  {
    id: 'duhalde',
    presidente: 'Eduardo Duhalde',
    partido: 'Partido Justicialista',
    desde: '2002-01-02',
    hasta: '2003-05-25',
    bloqueOficialista: /justicialista/,
  },
  {
    id: 'kirchner',
    presidente: 'Néstor Kirchner',
    partido: 'Frente para la Victoria (PJ)',
    desde: '2003-05-25',
    hasta: '2007-12-10',
    bloqueOficialista: /(frente para la victoria|justicialista)/,
  },
  {
    id: 'fernandez-de-kirchner',
    presidente: 'Cristina Fernández de Kirchner',
    partido: 'Frente para la Victoria (PJ)',
    desde: '2007-12-10',
    hasta: '2015-12-10',
    bloqueOficialista: /frente para la victoria/,
  },
  {
    id: 'macri',
    presidente: 'Mauricio Macri',
    partido: 'PRO (Cambiemos)',
    desde: '2015-12-10',
    hasta: '2019-12-10',
    bloqueOficialista: /(^pro$|union pro|^pro |cambiemos)/,
  },
  {
    id: 'fernandez',
    presidente: 'Alberto Fernández',
    partido: 'Frente de Todos (PJ)',
    desde: '2019-12-10',
    hasta: '2023-12-10',
    bloqueOficialista: /frente de todos/,
  },
  {
    id: 'milei',
    presidente: 'Javier G. Milei',
    partido: 'La Libertad Avanza',
    desde: '2023-12-10',
    hasta: null,
    bloqueOficialista: /la libertad avanza/,
  },
];

/** Gobierno vigente en una fecha ISO (AAAA-MM-DD...). */
export function gobiernoEn(fecha) {
  const f = String(fecha).slice(0, 10);
  for (let i = GOBIERNOS.length - 1; i >= 0; i--) {
    const g = GOBIERNOS[i];
    if (f >= g.desde && (g.hasta === null || f < g.hasta)) return g;
  }
  return null;
}

export function esBloqueOficialista(bloqueNormalizado, fecha) {
  const g = gobiernoEn(fecha);
  return Boolean(g && g.bloqueOficialista.test(bloqueNormalizado ?? ''));
}
