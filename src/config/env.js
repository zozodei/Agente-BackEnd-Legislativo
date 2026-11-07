import { z } from 'zod';

/**
 * Valida las variables de entorno al arrancar.
 * Si falta alguna obligatoria, el proceso termina indicando cuál.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    // Sin proxy por defecto. Configurar únicamente las redes del proxy de despliegue.
    TRUST_PROXY: z
      .string()
      .default('')
      .transform((v) => (v ? v.split(',').map((s) => s.trim()) : false)),
    SESSION_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    SUPABASE_JWT_AUDIENCE: z.string().min(1).default('authenticated'),
    SUPABASE_JWT_ISSUER: z.string().url().optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGINS: z
      .string({ error: 'Falta CORS_ORIGINS (ej: http://localhost:5173)' })
      .min(1, 'Definí al menos un origen (ej: http://localhost:5173)')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim().replace(/\/$/, ''))
          .filter(Boolean),
      )
      .refine(
        (origins) =>
          origins.length > 0 &&
          origins.every((origin) => {
            try {
              const url = new URL(origin);
              return ['http:', 'https:'].includes(url.protocol) && url.origin === origin;
            } catch {
              return false;
            }
          }),
        'CORS_ORIGINS debe contener orígenes HTTP(S) explícitos, sin rutas ni comodines',
      ),
    SUPABASE_URL: z
      .string({ error: 'Falta SUPABASE_URL' })
      .url('SUPABASE_URL debe ser una URL válida'),
    SUPABASE_PUBLISHABLE_KEY: z
      .string({ error: 'Falta SUPABASE_PUBLISHABLE_KEY' })
      .min(1, 'Falta SUPABASE_PUBLISHABLE_KEY'),
    SUPABASE_SECRET_KEY: z
      .string({ error: 'Falta SUPABASE_SECRET_KEY (necesaria para los poroteos)' })
      .min(1, 'Falta SUPABASE_SECRET_KEY (necesaria para los poroteos)'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_WRITE_MAX: z.coerce.number().int().positive().default(60),
    CACHE_DIPUTADOS_MINUTOS: z.coerce.number().nonnegative().default(10),
    // Ausente o vacía por defecto: no concede permisos.
    SUPERADMIN_EMAILS: z
      .string()
      .default('')
      .transform((value) =>
        Object.freeze(
          value
            .split(',')
            .map((email) => email.trim().toLowerCase())
            .filter(Boolean),
        ),
      ),
  })
  .superRefine((config, ctx) => {
    if (config.SESSION_SAME_SITE === 'none' && config.NODE_ENV !== 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SAME_SITE'],
        message: 'SameSite=None requiere HTTPS de producción (Secure)',
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      (!config.SUPABASE_URL.startsWith('https://') ||
        config.CORS_ORIGINS.some((origin) => !origin.startsWith('https://')))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'Producción requiere HTTPS para frontend y Supabase',
      });
    }
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
  return Object.freeze(parsed.data);
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
