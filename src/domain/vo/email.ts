/** Email normalizado a minúsculas (valor único en users.email). */
import { z } from 'zod';

const EMAIL_MAX = 254; // contrato 03 → schema Email

export const emailSchema = z
  .string({ message: 'email debe ser un string' })
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email({ message: 'invalid_email' })
      .max(EMAIL_MAX, { message: 'email_too_long' }),
  );

export type Email = z.infer<typeof emailSchema>;