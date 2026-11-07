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

/** Limita intentos de registro/login/refresh, incluidos los rechazados. */
export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

/** Búsqueda de cuentas únicamente como parte del alta autorizada de participantes. */
export const participantesLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

/** Combinar con límite IP anterior; el ID proviene de autenticar. */
export const participantesUsuarioLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  keyGenerator: (req) => req.usuario.id,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});
export const pdfIpLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  skip: (req) => !req.is('multipart/form-data'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});
export const pdfUsuarioLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  keyGenerator: (req) => req.usuario.id,
  skip: (req) => !req.is('multipart/form-data'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});
