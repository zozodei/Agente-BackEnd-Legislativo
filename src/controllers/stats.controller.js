import * as statsService from '../services/stats.service.js';

export async function resumen(_req, res) {
  res.json({ data: await statsService.getResumen() });
}
