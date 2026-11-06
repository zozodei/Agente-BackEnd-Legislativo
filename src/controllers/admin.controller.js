import * as adminService from '../services/admin.service.js';

export async function resumen(_req, res) {
  res.json({ data: await adminService.getResumen() });
}

export async function cuentas(req, res) {
  res.json(await adminService.listCuentas(req.valid.query));
}

export async function poroteos(req, res) {
  res.json(await adminService.listPoroteos(req.valid.query));
}

export async function poroteo(req, res) {
  res.json({ data: await adminService.getPoroteo(req.valid.params.id) });
}
