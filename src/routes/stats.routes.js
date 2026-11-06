import { Router } from 'express';
import * as stats from '../controllers/stats.controller.js';

const router = Router();

router.get('/stats/resumen', stats.resumen);

export default router;
