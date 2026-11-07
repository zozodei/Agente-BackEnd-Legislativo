import { z } from 'zod';

const email = z.string().trim().email('Revisá el formato del email').max(254).toLowerCase();

export const registroBody = z.object({
  nombre: z.string().trim().min(2, 'Ingresá tu nombre (mínimo 2 caracteres)').max(120),
  email,
  // No recortar contraseñas: los espacios forman parte del secreto.
  password: z
    .string()
    .min(8, 'Usá al menos 8 caracteres')
    .max(72)
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Máximo 72 bytes UTF-8'),
});

export const loginBody = z.object({
  email,
  password: z.string().min(1, 'Ingresá tu contraseña').max(1024),
});

export const refreshBody = z.object({ refreshToken: z.string().min(1).max(8192) });
// Precondición opcional del navegador: solo permite rechazar un cambio de cuenta.
export const expectedUserHeader = z.string().uuid().optional();

export const bearerHeader = z
  .string()
  .max(16384)
  .regex(/^Bearer [^\s]+$/i)
  .transform((value) => value.slice(7));
