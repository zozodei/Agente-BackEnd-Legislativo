import { Router } from 'express';
import { health } from '../controllers/health.controller.js';
import diputadosRoutes from './diputados.routes.js';
import catalogosRoutes from './catalogos.routes.js';
import votacionesRoutes from './votaciones.routes.js';
import statsRoutes from './stats.routes.js';
import poroteosRoutes from './poroteos.routes.js';
import authRoutes from './auth.routes.js';
import adminRoutes from './admin.routes.js';
import prediccionRoutes from './prediccion.routes.js';

export const router = Router();

router.get('/health', health);
router.use(authRoutes);
router.use(adminRoutes);
router.use(diputadosRoutes);
router.use(catalogosRoutes);
router.use(votacionesRoutes);
router.use(statsRoutes);
// Antes que poroteosRoutes: sus rutas /poroteos/:id/... no deben pasar por el router general.
router.use(prediccionRoutes);
router.use(poroteosRoutes);
