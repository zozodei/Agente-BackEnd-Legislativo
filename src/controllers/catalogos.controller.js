import * as catalogosService from '../services/catalogos.service.js';

export async function bloques(_req, res) {
  res.json({ data: await catalogosService.listBloques() });
}

export async function distritos(_req, res) {
  res.json({ data: await catalogosService.listDistritos() });
}
