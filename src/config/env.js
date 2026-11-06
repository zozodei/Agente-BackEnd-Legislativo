import { z } from 'zod';

/**
 * Valida las variables de entorno al arrancar.
 * Si falta alguna obligatoria, el proceso termina indicando cuál.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z
    .string({ required_error: 'Falta CORS_ORIGINS (ej: http://localhost:5173)' })
    .min(1, 'Definí al menos un origen (ej: http://localhost:5173)')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim().replace(/\/$/, ''))
        .filter(Boolean),
    ),
  // URL pública del frontend (origen, sin barra final). Por defecto el primer CORS_ORIGINS.
  // Se usa para el retorno de Google OAuth: FRONTEND_URL/auth/callback
  FRONTEND_URL: z
    .string()
    .url('FRONTEND_URL debe ser una URL válida')
    .transform((value) => value.trim().replace(/\/$/, ''))
    .optional(),
  SUPABASE_URL: z
    .string({ required_error: 'Falta SUPABASE_URL' })
    .url('SUPABASE_URL debe ser una URL válida'),
  SUPABASE_PUBLISHABLE_KEY: z
    .string({ required_error: 'Falta SUPABASE_PUBLISHABLE_KEY' })
    .min(1, 'Falta SUPABASE_PUBLISHABLE_KEY'),
  SUPABASE_SECRET_KEY: z
    .string({ required_error: 'Falta SUPABASE_SECRET_KEY (necesaria para los poroteos)' })
    .min(1, 'Falta SUPABASE_SECRET_KEY (necesaria para los poroteos)'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WRITE_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60_000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),
  CACHE_DIPUTADOS_MINUTOS: z.coerce.number().nonnegative().default(10),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(
      `\nVariables de entorno inválidas o faltantes:\n${detalle}\n\nRevisá tu .env (ver .env.example).\n`,
    );
    process.exit(1);
  }
  const data = {
    ...parsed.data,
    FRONTEND_URL: parsed.data.FRONTEND_URL ?? parsed.data.CORS_ORIGINS[0],
  };
  return Object.freeze(data);
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
