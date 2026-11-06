import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { validate } from '../middlewares/validate.js';
import { authToken } from '../middlewares/authToken.js';
import { authLimiter } from '../middlewares/rateLimit.js';
import { loginBody, refreshBody, registroBody } from '../validators/auth.validator.js';

const router = Router();

// Las respuestas con credenciales no deben guardarse en cachés compartidas.
router.use('/auth', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.post('/auth/registro', authLimiter, validate({ body: registroBody }), auth.registrar);
router.post('/auth/login', authLimiter, validate({ body: loginBody }), auth.login);
router.post('/auth/refresh', authLimiter, validate({ body: refreshBody }), auth.refresh);
router.get('/auth/me', authToken, auth.me);
router.post('/auth/logout', authToken, auth.logout);

export default router;
