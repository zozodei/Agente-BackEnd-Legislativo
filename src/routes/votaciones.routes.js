import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import * as votaciones from '../controllers/votaciones.controller.js';
import { listVotacionesQuery, votacionParams } from '../validators/votaciones.validator.js';

const router = Router();

router.get('/votaciones', validate({ query: listVotacionesQuery }), votaciones.list);
router.get('/votaciones/:id', validate({ params: votacionParams }), votaciones.get);

export default router;
