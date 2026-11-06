import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authLimiter } from '../middlewares/rateLimit.js';
import { requireAuth } from '../middlewares/auth.js';
import * as auth from '../controllers/auth.controller.js';
import { googleQuery, idTokenBody, refreshBody } from '../validators/auth.validator.js';

const router = Router();

// ── Login con Google (Supabase Auth) ─────────────────────────────────────
// El front pide la URL, redirige, y en /auth/callback usa el token del hash para /auth/me.
router.get('/auth/google', authLimiter, validate({ query: googleQuery }), auth.googleUrl);
router.post(
  '/auth/google/id-token',
  authLimiter,
  validate({ body: idTokenBody }),
  auth.googleIdToken,
);
router.post('/auth/refresh', authLimiter, validate({ body: refreshBody }), auth.refresh);
router.post('/auth/logout', requireAuth, auth.logout);
router.get('/auth/me', requireAuth, auth.me);

export default router;
