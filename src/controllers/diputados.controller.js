import * as diputadosService from '../services/diputados.service.js';

export async function list(req, res) {
  res.json(await diputadosService.listDiputados(req.valid.query));
}

export async function get(req, res) {
  res.json({ data: await diputadosService.getDiputado(req.valid.params.id) });
}

export async function votos(req, res) {
  res.json(await diputadosService.getVotosDiputado(req.valid.params.id, req.valid.query));
}
