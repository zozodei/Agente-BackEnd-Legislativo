import { Router } from 'express';
import * as catalogos from '../controllers/catalogos.controller.js';

const router = Router();

router.get('/bloques', catalogos.bloques);
router.get('/distritos', catalogos.distritos);

export default router;
