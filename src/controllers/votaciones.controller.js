import * as votacionesService from '../services/votaciones.service.js';

export async function list(req, res) {
  res.json(await votacionesService.listVotaciones(req.valid.query));
}

export async function get(req, res) {
  res.json({ data: await votacionesService.getVotacion(req.valid.params.id) });
}
