import { z } from 'zod';
import { emailSchema, magicLinkPurposeSchema, plainPasswordSchema } from '../../domain/vo/index.js';

/** Schemas de la frontera (doc 03 → CredentialsRequest/RefreshRequest/GoogleRequest).
 *  Se componen sobre los schemas de los VOs (doc 00 → ítem 88: composición, no redeclaración):
 *  el parse emite VOs tipados (Email, PlainPassword) que circulan hasta el caso de uso. */
export const credentialsRequest = z.object({
  email: emailSchema,
  password: plainPasswordSchema,
});

export const refreshRequest = z.object({
  refreshToken: z.string({ message: 'refreshToken debe ser un string' }).min(1, { message: 'too_short' }),
});

export const googleRequest = z.object({
  idToken: z.string({ message: 'idToken debe ser un string' }).min(1, { message: 'too_short' }),
  nonce: z.string({ message: 'nonce debe ser un string' }).min(1, { message: 'too_short' }).optional(),
});

export const magicLinkRequest = z.object({
  email: emailSchema,
  // Omiso = 'login' (US-09/10); 'password_reset' selecciona el canal y la base de consumo (US-12).
  intent: magicLinkPurposeSchema.optional(),
});

export const magicLinkConsumeRequest = z.object({
  token: z.string({ message: 'token debe ser un string' }).min(1, { message: 'too_short' }),
});

export const changePasswordRequest = z.object({
  currentPassword: plainPasswordSchema,
  newPassword: plainPasswordSchema,
});

export const passwordResetRequest = z.object({
  token: z.string({ message: 'token debe ser un string' }).min(1, { message: 'too_short' }),
  password: plainPasswordSchema,
});