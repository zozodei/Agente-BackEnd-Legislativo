import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const handler = (_req, res) =>
  res.status(429).json({
    error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Probá de nuevo en un rato.' },
  });

/** Límite general para toda la API. */
export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

/** Límite más estricto para escrituras (POST / PUT / DELETE). */
export const writeLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_WRITE_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
  handler,
});
