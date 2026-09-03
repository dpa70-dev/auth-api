/** Hash argon2id en reposo (doc 00 → ítem 35). Texto opaco; solo se compara con verify(). */
import { z } from 'zod';

export const passwordHashSchema = z
  .string({ message: 'password_hash debe ser un string' })
  .min(20, { message: 'invalid_hash' }) // longitud mínima de un hash argon2id serializado

export type PasswordHash = z.infer<typeof passwordHashSchema>;