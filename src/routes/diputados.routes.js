import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import * as diputados from '../controllers/diputados.controller.js';
import {
  diputadoParams,
  listDiputadosQuery,
  votosDiputadoQuery,
} from '../validators/diputados.validator.js';

const router = Router();

router.get('/diputados', validate({ query: listDiputadosQuery }), diputados.list);
router.get('/diputados/:id', validate({ params: diputadoParams }), diputados.get);
router.get(
  '/diputados/:id/votos',
  validate({ params: diputadoParams, query: votosDiputadoQuery }),
  diputados.votos,
);

export default router;
