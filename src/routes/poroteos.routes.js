import { Router } from 'express';
import { autenticar } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { writeLimiter } from '../middlewares/rateLimit.js';
import { uploadPdf } from '../middlewares/upload.js';
import * as poroteos from '../controllers/poroteos.controller.js';
import {
  createPoroteoBody,
  listPoroteosQuery,
  poroteoParams,
  putVotosBody,
  updatePoroteoBody,
} from '../validators/poroteos.validator.js';

const router = Router();

router.use(
  '/poroteos',
  autenticar,
  (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  },
  writeLimiter,
);
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

export default router;
