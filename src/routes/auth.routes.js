import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { validate } from '../middlewares/validate.js';
import { authToken, logoutTokens } from '../middlewares/authToken.js';
import { authLimiter } from '../middlewares/rateLimit.js';
import { loginBody, refreshBody, registroBody } from '../validators/auth.validator.js';
import { readCookie, REFRESH_COOKIE, clearSessionCookies } from '../middlewares/sessionSecurity.js';
import { AppError } from '../utils/AppError.js';

const router = Router();

// Las respuestas con credenciales no deben guardarse en cachés compartidas.
router.use('/auth', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.post('/auth/registro', authLimiter, validate({ body: registroBody }), auth.registrar);
router.post('/auth/login', authLimiter, validate({ body: loginBody }), auth.login);
router.post(
  '/auth/refresh',
  authLimiter,
  (req, res, next) => {
    if (req.cookieSession) {
      const refreshToken = readCookie(req, REFRESH_COOKIE);
      if (!refreshToken) {
        clearSessionCookies(res);
        return next(new AppError(401, 'SESSION_EXPIRED', 'La sesión venció o no es válida'));
      }
      req.body = { refreshToken };
    }
    return next();
  },
  validate({ body: refreshBody }),
  auth.refresh,
);
router.get('/auth/me', authToken, auth.me);
router.post(
  '/auth/logout',
  (req, res, next) => {
    if (req.cookieSession) clearSessionCookies(res);
    next();
  },
  logoutTokens,
  auth.logout,
);

export default router;
