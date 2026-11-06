import { Router } from 'express';
import { health } from '../controllers/health.controller.js';
import diputadosRoutes from './diputados.routes.js';
import catalogosRoutes from './catalogos.routes.js';
import votacionesRoutes from './votaciones.routes.js';
import statsRoutes from './stats.routes.js';
import poroteosRoutes from './poroteos.routes.js';
import authRoutes from './auth.routes.js';

export const router = Router();

router.get('/health', health);
router.use(diputadosRoutes);
router.use(catalogosRoutes);
router.use(votacionesRoutes);
router.use(statsRoutes);
router.use(poroteosRoutes);
router.use(authRoutes);
