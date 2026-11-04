import { DIPUTADOS_TOTAL, QUORUM_DIPUTADOS } from '../config/constants.js';

/**
 * Cálculo del resultado de un poroteo. Función pura: sin acceso a datos.
 * (El frontend tiene una copia equivalente en src/features/poroteo/resultado.ts
 *  para el contador en vivo. Si cambiás una, cambiá la otra.)
 *
 * Reglas (Cámara de Diputados):
 *  - Presentes = afirmativos + negativos + abstenciones.
 *  - Quórum = 129 presentes (mayoría absoluta de 257).
 *  - simple      → afirmativos > negativos (las abstenciones no suman a ningún lado).
 *  - absoluta    → afirmativos >= 129 (mitad + 1 del total de miembros).
 *  - dos_tercios → afirmativos >= 2/3 de los presentes.
 *  - INDEFINIDO y diputados sin asignar = votos todavía en disputa.
 *    Se evalúa el mejor y el peor caso para saber si el resultado ya está definido.
 */
export function calcularResultado(votos, tipoMayoria = 'simple', total = DIPUTADOS_TOTAL) {
  const conteo = { AFIRMATIVO: 0, NEGATIVO: 0, ABSTENCION: 0, AUSENTE: 0, INDEFINIDO: 0 };
  for (const voto of votos) if (voto in conteo) conteo[voto] += 1;
  const asignados = Object.values(conteo).reduce((a, b) => a + b, 0);
  const sinAsignar = Math.max(0, total - asignados);
  const enDisputa = conteo.INDEFINIDO + sinAsignar;

  const evaluar = (afirmativos, negativos, abstenciones) => {
    const presentes = afirmativos + negativos + abstenciones;
    if (presentes < QUORUM_DIPUTADOS) return 'SIN_QUORUM';
    const requeridos = votosRequeridos(tipoMayoria, presentes, negativos);
    return afirmativos >= requeridos ? 'APROBADO' : 'RECHAZADO';
  };

  const { AFIRMATIVO: afi, NEGATIVO: neg, ABSTENCION: abs } = conteo;
  const presentes = afi + neg + abs;
  const actual = evaluar(afi, neg, abs);
  const mejorCaso = evaluar(afi + enDisputa, neg, abs);
  const peorCaso = evaluar(afi, neg + enDisputa, abs);
  const definido = enDisputa === 0 || mejorCaso === peorCaso;

  const requeridos = votosRequeridos(tipoMayoria, Math.max(presentes, QUORUM_DIPUTADOS), neg);

  return {
    tipoMayoria,
    conteo: { ...conteo, sinAsignar },
    presentes,
    enDisputa,
    quorum: {
      requerido: QUORUM_DIPUTADOS,
      alcanzado: presentes >= QUORUM_DIPUTADOS,
      faltan: Math.max(0, QUORUM_DIPUTADOS - presentes),
    },
    mayoria: { requeridos, faltan: Math.max(0, requeridos - afi) },
    resultado: actual,
    escenarios: { mejorCaso, peorCaso },
    definido,
  };
}

function votosRequeridos(tipoMayoria, presentes, negativos) {
  switch (tipoMayoria) {
    case 'absoluta':
      return QUORUM_DIPUTADOS;
    case 'dos_tercios':
      return Math.ceil((presentes * 2) / 3);
    case 'simple':
    default:
      return negativos + 1;
  }
}
