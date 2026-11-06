import { z } from 'zod';

const email = z
  .string({ required_error: 'Falta el email' })
  .trim()
  .toLowerCase()
  .email('El email no es válido')
  .max(254);

// 72 es el máximo que admite bcrypt (lo que usa Supabase Auth).
const password = z.string({ required_error: 'Falta la contraseña' }).max(72);

export const registroBody = z.object({
  email,
  password: password.min(8, 'La contraseña debe tener al menos 8 caracteres'),
  nombre: z
    .string({ required_error: 'Falta el nombre' })
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(120),
});

export const loginBody = z.object({
  email,
  password: password.min(1, 'Falta la contraseña'),
});

export const googleCallbackBody = z.object({
  code: z.string({ required_error: 'Falta el código de Google' }).trim().min(1).max(500),
  codeVerifier: z
    .string({ required_error: 'Falta el codeVerifier' })
    .regex(/^[A-Za-z0-9._~-]{43,128}$/, 'codeVerifier inválido'),
});

export const refreshBody = z.object({
  refreshToken: z.string({ required_error: 'Falta el refreshToken' }).min(1).max(2000),
});
