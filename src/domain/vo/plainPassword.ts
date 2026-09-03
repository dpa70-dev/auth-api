/** Contraseña en claro (NIST 800-63B: 8-64, sin reglas de complejidad). NUNCA se persiste. */
import { z } from 'zod';

export const plainPasswordSchema = z
  .string({ message: 'password debe ser un string' })
  .min(8, { message: 'too_short' })
  .max(64, { message: 'too_long' });

export type PlainPassword = z.infer<typeof plainPasswordSchema>;