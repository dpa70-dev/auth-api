import { z } from 'zod';

/** Schemas de la frontera (doc 03 → CredentialsRequest/RefreshRequest/GoogleRequest). */
export const credentialsRequest = z.object({
  email: z
    .string({ message: 'email debe ser un string' })
    .trim()
    .toLowerCase()
    .pipe(z.email({ message: 'invalid_email' }).max(254, { message: 'email_too_long' })),
  password: z
    .string({ message: 'password debe ser un string' })
    .min(8, { message: 'too_short' })
    .max(64, { message: 'too_long' }),
});

export const refreshRequest = z.object({
  refreshToken: z.string({ message: 'refreshToken debe ser un string' }).min(1, { message: 'too_short' }),
});

export const googleRequest = z.object({
  idToken: z.string({ message: 'idToken debe ser un string' }).min(1, { message: 'too_short' }),
  nonce: z.string({ message: 'nonce debe ser un string' }).min(1, { message: 'too_short' }).optional(),
});

export const magicLinkRequest = z.object({
  email: z
    .string({ message: 'email debe ser un string' })
    .trim()
    .toLowerCase()
    .pipe(z.email({ message: 'invalid_email' }).max(254, { message: 'email_too_long' })),
});

export const magicLinkConsumeRequest = z.object({
  token: z.string({ message: 'token debe ser un string' }).min(1, { message: 'too_short' }),
});