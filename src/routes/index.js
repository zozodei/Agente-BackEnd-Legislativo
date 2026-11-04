import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { writeLimiter } from '../middlewares/rateLimit.js';
import { uploadPdf } from '../middlewares/upload.js';
import * as catalogos from '../controllers/catalogos.controller.js';
import * as diputados from '../controllers/diputados.controller.js';
import * as poroteos from '../controllers/poroteos.controller.js';
import * as stats from '../controllers/stats.controller.js';
import * as votaciones from '../controllers/votaciones.controller.js';
import {
  diputadoParams,
  listDiputadosQuery,
  votosDiputadoQuery,
} from '../validators/diputados.validator.js';
import { listVotacionesQuery, votacionParams } from '../validators/votaciones.validator.js';
import {
  createPoroteoBody,
  listPoroteosQuery,
  poroteoParams,
  putVotosBody,
  updatePoroteoBody,
} from '../validators/poroteos.validator.js';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ── Lectura: datos de ¿Cómo Votó? ──────────────────────────────────────────
router.get('/diputados', validate({ query: listDiputadosQuery }), diputados.list);
router.get('/diputados/:id', validate({ params: diputadoParams }), diputados.get);
router.get(
  '/diputados/:id/votos',
  validate({ params: diputadoParams, query: votosDiputadoQuery }),
  diputados.votos,
);
router.get('/bloques', catalogos.bloques);
router.get('/distritos', catalogos.distritos);
router.get('/votaciones', validate({ query: listVotacionesQuery }), votaciones.list);
router.get('/votaciones/:id', validate({ params: votacionParams }), votaciones.get);
router.get('/stats/resumen', stats.resumen);

// ── Poroteo manual (tablas propias) ────────────────────────────────────────
router.use('/poroteos', writeLimiter);
router.post('/poroteos', uploadPdf, validate({ body: createPoroteoBody }), poroteos.create);
router.get('/poroteos', validate({ query: listPoroteosQuery }), poroteos.list);
router.get('/poroteos/:id', validate({ params: poroteoParams }), poroteos.get);
router.patch(
  '/poroteos/:id',
  validate({ params: poroteoParams, body: updatePoroteoBody }),
  poroteos.update,
);
router.put(
  '/poroteos/:id/votos',
  validate({ params: poroteoParams, body: putVotosBody }),
  poroteos.saveVotos,
);
router.delete('/poroteos/:id', validate({ params: poroteoParams }), poroteos.remove);
