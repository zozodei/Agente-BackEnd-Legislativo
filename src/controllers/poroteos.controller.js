import * as poroteosService from '../services/poroteos.service.js';

export async function create(req, res) {
  const poroteo = await poroteosService.createPoroteo(req.valid.body, req.file);
  res.status(201).location(`/api/poroteos/${poroteo.id}`).json({ data: poroteo });
}

export async function list(req, res) {
  res.json(await poroteosService.listPoroteos(req.valid.query));
}

export async function get(req, res) {
  res.json({ data: await poroteosService.getPoroteo(req.valid.params.id) });
}

export async function update(req, res) {
  res.json({ data: await poroteosService.updatePoroteo(req.valid.params.id, req.valid.body) });
}

export async function saveVotos(req, res) {
  res.json({ data: await poroteosService.saveVotos(req.valid.params.id, req.valid.body) });
}

export async function remove(req, res) {
  await poroteosService.deletePoroteo(req.valid.params.id);
  res.status(204).end();
}
