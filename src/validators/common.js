import { z } from 'zod';

/** Booleanos que llegan por query string ("true" / "false" / "1" / "0"). */
export const queryBoolean = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

export const pagination = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
};

export const searchText = z.string().trim().max(120).optional();

export const intIdParams = z.object({ id: z.coerce.number().int().positive() });

export const uuidParams = z.object({ id: z.string().uuid('El id debe ser un UUID') });

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usá el formato AAAA-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'Fecha inexistente')
  .optional();
