import { env } from '../config/env.js';
import { solicitarPrediccion } from '../clients/predictor.client.js';
import { AppError } from '../utils/AppError.js';
import { prediccionServicioSchema } from '../validators/prediccion.validator.js';
import { getAllDiputados } from './diputados.service.js';
import { getPoroteo } from './poroteos.service.js';
import { simularPrediccion } from './prediccion/simulador.js';

/**
 * Estima con IA los votos de un poroteo. NO guarda nada: devuelve la propuesta para que
 * la persona la revise en el editor y la guarde con PUT /poroteos/:id/votos (origen 'ia').
 * Así no hace falta una migración para persistir la predicción y nada se pisa sin querer.
 */
export function modoPredictor() {
  if (env.PREDICTOR_URL) return 'servicio';
  if (env.PREDICTOR_SIMULADO) return 'simulado';
  return 'apagado';
}

export async function predecirPoroteo(id, userId) {
  const modo = modoPredictor();
  if (modo === 'apagado') {
    throw AppError.unavailable('La predicción con IA todavía no está disponible.');
  }

  // getPoroteo exige sesión y membresía: un ajeno recibe 404, igual que en el resto.
  const poroteo = await getPoroteo(id, userId);
  if (!poroteo.permisos.editar) {
    throw new AppError(403, 'FORBIDDEN', 'No tenés permiso para editar este poroteo');
  }
  if (poroteo.camara !== 'diputados') {
    throw AppError.badRequest('Por ahora la predicción solo está disponible para Diputados');
  }

  const diputados = await getAllDiputados();
  const entrada = {
    proyecto: {
      id: poroteo.id,
      titulo: poroteo.titulo,
      descripcion: poroteo.descripcion,
      texto: poroteo.textoProyecto,
      autor: poroteo.autor,
      tipoMayoria: poroteo.tipoMayoria,
      camara: poroteo.camara,
    },
    diputados: diputados.map((d) => ({
      id: d.id,
      apellido: d.apellido,
      nombre: d.nombre,
      distrito: d.distrito,
      bloque: d.bloque,
      personaId: d.personaId,
      presentismo: d.presentismo,
    })),
  };

  const crudo =
    modo === 'servicio' ? await solicitarPrediccion(entrada) : simularPrediccion(entrada);
  const parsed = prediccionServicioSchema.safeParse(crudo);
  if (!parsed.success) {
    throw AppError.upstream('El servicio de predicción devolvió un formato inesperado.');
  }
  const prediccion = parsed.data;
  if (modo === 'servicio' && prediccion.modelo.simulado) {
    throw AppError.upstream('El servicio de predicción devolvió una simulación.');
  }

  // Solo diputados actuales, sin repetidos. Los faltantes quedan sin asignar en el editor.
  const validos = new Set(diputados.map((d) => d.id));
  const vistos = new Set();
  const votos = prediccion.votos.filter((v) => {
    if (!validos.has(v.diputadoId) || vistos.has(v.diputadoId)) return false;
    vistos.add(v.diputadoId);
    return true;
  });
  const advertencias = [...prediccion.advertencias];
  const descartados = prediccion.votos.length - votos.length;
  if (descartados > 0) {
    advertencias.push(
      `Se descartaron ${descartados} votos de diputados que no están en la Cámara.`,
    );
  }
  const faltantes = diputados.length - votos.length;
  if (faltantes > 0) {
    advertencias.push(`${faltantes} diputados quedaron sin predicción: se dejan sin asignar.`);
  }

  return {
    poroteoId: poroteo.id,
    version: poroteo.version,
    generadaEn: new Date().toISOString(),
    ...prediccion,
    votos,
    advertencias,
  };
}
