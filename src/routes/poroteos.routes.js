import { Router } from 'express';
import { autenticar } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import {
  writeLimiter,
  participantesLimiter,
  participantesUsuarioLimiter,
  pdfIpLimiter,
  pdfUsuarioLimiter,
} from '../middlewares/rateLimit.js';
import { uploadPdf } from '../middlewares/upload.js';
import * as poroteos from '../controllers/poroteos.controller.js';
import {
  createPoroteoBody,
  listPoroteosQuery,
  poroteoParams,
  putVotosBody,
  updatePoroteoBody,
  versionBody,
  miembroParams,
  agregarMiembroBody,
  cambiarRolBody,
} from '../validators/poroteos.validator.js';

const router = Router();
const noStore = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

router.use('/poroteos-publicos', noStore);
router.get('/poroteos-publicos', validate({ query: listPoroteosQuery }), poroteos.listPublicos);
router.get('/poroteos-publicos/:id', validate({ params: poroteoParams }), poroteos.getPublico);

router.use('/poroteos', noStore, autenticar, writeLimiter);
router.post(
  '/poroteos',
  pdfIpLimiter,
  pdfUsuarioLimiter,
  uploadPdf,
  validate({ body: createPoroteoBody }),
  poroteos.create,
);
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
router.delete(
  '/poroteos/:id',
  validate({ params: poroteoParams, body: versionBody }),
  poroteos.remove,
);
router.get('/poroteos/:id/miembros', validate({ params: poroteoParams }), poroteos.listMiembros);
router.post(
  '/poroteos/:id/miembros',
  participantesLimiter,
  participantesUsuarioLimiter,
  validate({ params: poroteoParams, body: agregarMiembroBody }),
  poroteos.agregarMiembro,
);
router.patch(
  '/poroteos/:id/miembros/:userId',
  validate({ params: miembroParams, body: cambiarRolBody }),
  poroteos.cambiarMiembro,
);
router.delete(
  '/poroteos/:id/miembros/:userId',
  validate({ params: miembroParams, body: versionBody }),
  poroteos.quitarMiembro,
);
router.post(
  '/poroteos/:id/salir',
  validate({ params: poroteoParams, body: versionBody }),
  poroteos.salir,
);

export default router;
