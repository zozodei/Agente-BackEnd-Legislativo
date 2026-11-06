import { Router } from 'express';
import { autenticar, soloSuperadmin } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { listCuentasQuery } from '../validators/admin.validator.js';
import { listPoroteosQuery, poroteoParams } from '../validators/poroteos.validator.js';
import * as admin from '../controllers/admin.controller.js';

const router = Router();
// El guard cubre todo /admin, también rutas nuevas, métodos no soportados y errores.
router.use(
  '/admin',
  (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  },
  autenticar,
  soloSuperadmin,
);
router.get('/admin/resumen', admin.resumen);
router.get('/admin/cuentas', validate({ query: listCuentasQuery }), admin.cuentas);
router.get('/admin/poroteos', validate({ query: listPoroteosQuery }), admin.poroteos);
router.get('/admin/poroteos/:id', validate({ params: poroteoParams }), admin.poroteo);

export default router;
