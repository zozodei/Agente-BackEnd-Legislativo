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

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Detrás de un proxy (Render, Railway, etc.) para que el rate limit vea la IP real.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        // Requests sin Origin (curl, health checks, server-to-server) se permiten.
        if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new AppError(403, 'CORS_FORBIDDEN', `Origen no permitido: ${origin}`));
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      maxAge: 600,
    }),
  );
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', apiLimiter, router);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
