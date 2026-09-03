/** `sub` de Google (OIDC) — columna users.google_sub. */
import { z } from 'zod';

export const googleSubSchema = z
  .string({ message: 'google_sub debe ser un string' })
  .min(1, { message: 'too_short' })
  .max(256, { message: 'too_long' });

export type GoogleSub = z.infer<typeof googleSubSchema>;