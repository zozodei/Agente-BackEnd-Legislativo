import pino from 'pino';
import { env, isProduction, isTest } from './env.js';

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers.apikey',
    'res.headers["set-cookie"]',
    'password',
    'accessToken',
    'refreshToken',
    '*.password',
    '*.access_token',
    '*.refresh_token',
    'req.body.password',
    'req.body.refreshToken',
    'res.body.data.sesion.accessToken',
    'res.body.data.sesion.refreshToken',
  ],
  ...(isProduction || isTest
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});
