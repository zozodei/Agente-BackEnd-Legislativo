import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { apiLimiter } from './middlewares/rateLimit.js';
import { errorHandler, notFound } from './middlewares/errorHandler.js';
import { AppError } from './utils/AppError.js';
import { router } from './routes/index.js';
import { sessionSecurity } from './middlewares/sessionSecurity.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Detrás de un proxy (Render, Railway, etc.) para que el rate limit vea la IP real.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet());
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(
    cors({
      origin(origin, callback) {
        // Requests sin Origin (curl, health checks, server-to-server) se permiten.
        if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new AppError(403, 'CORS_FORBIDDEN', `Origen no permitido: ${origin}`));
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Mode', 'X-Expected-User'],
      maxAge: 600,
    }),
  );
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return { id: req.id, method: req.method, url: req.url?.split('?')[0] };
        },
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );
  app.use('/api', sessionSecurity);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', apiLimiter, router);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
