import { Router } from 'express';
import { autenticar } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { writeLimiter } from '../middlewares/rateLimit.js';
import * as prediccion from '../controllers/prediccion.controller.js';
import { poroteoParams } from '../validators/poroteos.validator.js';
import {
  ajustesBody,
  analizarBody,
  generarPrediccionBody,
  resultadoQuery,
} from '../validators/prediccion.validator.js';

const router = Router();
const noStore = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

// Públicas: información del modelo y análisis de un texto (no guardan nada).
router.get('/prediccion/modelo', prediccion.modelo);
router.post(
  '/prediccion/analizar',
  writeLimiter,
  validate({ body: analizarBody }),
  prediccion.analizar,
);

// Privadas: requieren sesión y membresía en el poroteo.
const privadas = [noStore, autenticar, writeLimiter];
router.post(
  '/poroteos/:id/prediccion',
  ...privadas,
  validate({ params: poroteoParams, body: generarPrediccionBody }),
  prediccion.generar,
);
router.get(
  '/poroteos/:id/prediccion',
  ...privadas,
  validate({ params: poroteoParams }),
  prediccion.obtener,
);
router.post(
  '/poroteos/:id/ajustes',
  ...privadas,
  validate({ params: poroteoParams, body: ajustesBody }),
  prediccion.ajustar,
);
router.get(
  '/poroteos/:id/resultado',
  ...privadas,
  validate({ params: poroteoParams, query: resultadoQuery }),
  prediccion.resultado,
);

export default router;
