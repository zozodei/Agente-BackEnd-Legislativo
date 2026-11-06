import { z } from 'zod';

export const googleQuery = z.object({
  redirectTo: z.string().trim().url('El redirectTo debe ser una URL válida').max(500).optional(),
});

export const refreshBody = z.object({
  refreshToken: z
    .string({ required_error: 'Falta el refreshToken' })
    .min(1, 'Falta el refreshToken')
    .max(2000),
});

export const idTokenBody = z.object({
  idToken: z.string({ required_error: 'Falta el idToken' }).min(1).max(4000),
  nonce: z.string().trim().min(1).max(500).optional(),
});
