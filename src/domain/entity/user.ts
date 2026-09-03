/**
 * Entidad Usuario (doc 00 → ítem 45, doc 04 → users).
 *
 * Regla: solo se construye desde VOs ya validados o desde resultados de repositorio
 * pre-validados; el dominio no conoce Express ni SQLite.
 */
import {
  emailSchema,
  googleSubSchema,
  passwordHashSchema,
  timestampSchema,
  userIdSchema,
  type Email,
  type GoogleSub,
  type PasswordHash,
  type Timestamp,
  type UserId,
} from '../vo/index.js';
import { z } from 'zod';

/**
 * Usuario (doc 00 → ítem 45, doc 04 → users).
 * passwordHash NULL ⇔ solo-Google · googleSub NULL ⇔ solo-local · ambos NULL prohibido por CHECK.
 */
export type User = {
  readonly id: UserId;
  readonly email: Email;
  readonly passwordHash: PasswordHash | null;
  readonly googleSub: GoogleSub | null;
  readonly emailVerified: boolean;
  readonly createdAt: Timestamp;
};

/** Datos de alta para un usuario local (US-01) o implícito Google (US-07). */
export type NewUser = {
  readonly id: UserId;
  readonly email: Email;
  readonly passwordHash: PasswordHash | null;
  readonly googleSub: GoogleSub | null;
  /** local → false · Google → true (doc 00 → ítem 45, US-07 AC-02) */
  readonly emailVerified: boolean;
};

export const newUserSchema = z
  .object({
    id: userIdSchema,
    email: emailSchema,
    passwordHash: passwordHashSchema.nullable(),
    googleSub: googleSubSchema.nullable(),
    emailVerified: z.boolean(),
  })
  .refine((u) => u.passwordHash !== null || u.googleSub !== null, {
    message: 'al menos una identidad (password_hash o google_sub)',
  });

/** `users` persistidos malformados no deben entrar al dominio: parsear antes de usar. */
export const userSchema = newUserSchema.extend({
  createdAt: timestampSchema,
});

/** Defiende la invariante del CHECK del modelo de datos en el dominio. */
export const validateNewUser = (u: NewUser): NewUser => newUserSchema.parse(u);