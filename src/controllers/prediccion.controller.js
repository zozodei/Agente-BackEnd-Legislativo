import * as prediccionService from '../services/prediccion.service.js';

export function modelo(_req, res) {
  res.json({ data: prediccionService.getModelo() });
}

export function analizar(req, res) {
  res.json({ data: prediccionService.analizarProyecto(req.valid.body) });
}

export async function generar(req, res) {
  res.json({
    data: await prediccionService.generarPrediccion(
      req.valid.params.id,
      req.valid.body,
      req.usuario.id,
    ),
  });
}

export async function obtener(req, res) {
  res.json({ data: await prediccionService.getPrediccion(req.valid.params.id, req.usuario.id) });
}

export async function ajustar(req, res) {
  res.json({
    data: await prediccionService.ajustarVotos(req.valid.params.id, req.valid.body, req.usuario.id),
  });
}

export async function resultado(req, res) {
  res.json({
    data: await prediccionService.getResultado(
      req.valid.params.id,
      req.valid.query.tipoMayoria,
      req.usuario.id,
    ),
  });
}
