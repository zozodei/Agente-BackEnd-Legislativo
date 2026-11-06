import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authLimiter, writeLimiter } from '../middlewares/rateLimit.js';
import { requireAuth } from '../middlewares/auth.js';
import * as auth from '../controllers/auth.controller.js';
import { loginBody, refreshBody, registroBody } from '../validators/auth.validator.js';

// Cuentas de usuario (Supabase Auth por detrás).
const router = Router();

router.post('/auth/registro', authLimiter, validate({ body: registroBody }), auth.registro);
router.post('/auth/login', authLimiter, validate({ body: loginBody }), auth.login);
router.post('/auth/refresh', writeLimiter, validate({ body: refreshBody }), auth.refresh);
router.post('/auth/logout', requireAuth, auth.logout);
router.get('/auth/me', requireAuth, auth.me);

export default router;
