import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createApp } from './app.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`API escuchando en http://localhost:${env.PORT}/api (${env.NODE_ENV})`);
});

function shutdown(signal) {
  logger.info(`${signal} recibido, cerrando servidor...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Promesa rechazada sin manejar');
});
