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
  userKindSchema,
  type Email,
  type GoogleSub,
  type PasswordHash,
  type Timestamp,
  type UserId,
  type UserKind,
} from '../vo/index.js';
import { z } from 'zod';

/**
 * Usuario (doc 00 → ítem 45, doc 04 → users).
 * passwordHash NULL ⇔ solo-Google · googleSub NULL ⇔ solo-local · ambos NULL prohibido por CHECK
 * salvo kind = 'guest' (doc 04 → users.kind: cuenta anónima sin identidad).
 */
export type User = {
  readonly id: UserId;
  readonly email: Email | null;
  readonly passwordHash: PasswordHash | null;
  readonly googleSub: GoogleSub | null;
  readonly emailVerified: boolean;
  readonly kind: UserKind;
  readonly createdAt: Timestamp;
};

/** Datos de alta para un usuario local (US-01), implícito Google (US-07), auto-cuenta (US-10/14) o guest (US-15). */
export type NewUser = {
  readonly id: UserId;
  readonly email: Email | null;
  readonly passwordHash: PasswordHash | null;
  readonly googleSub: GoogleSub | null;
  /** local → false · Google → true (doc 00 → ítem 45, US-07 AC-02) */
  readonly emailVerified: boolean;
  /** registered (default retrocompatible) · guest: anónima sin identidad (US-15) */
  readonly kind: UserKind;
};

export const newUserSchema = z
  .object({
    id: userIdSchema,
    email: emailSchema.nullable(),
    passwordHash: passwordHashSchema.nullable(),
    googleSub: googleSubSchema.nullable(),
    emailVerified: z.boolean(),
    kind: userKindSchema.default('registered'),
  })
  .refine(
    (u) => {
      // Espejo del CHECK de identidad de users (doc 04 → decisión 11 + T10):
      // guest puede existir SIN identidad (cuenta anónima, US-15); cualquier otro
      // tipo exige email + al menos una identidad (password_hash, google_sub o email verificado).
      if (u.kind === 'guest') return true;
      return u.email !== null && (u.passwordHash !== null || u.googleSub !== null || u.emailVerified === true);
    },
    {
      message: 'registered requiere email + una identidad (password_hash, google_sub o email verificado)',
    },
  );

/** `users` persistidos malformados no deben entrar al dominio: parsear antes de usar. */
export const userSchema = newUserSchema.extend({
  createdAt: timestampSchema,
});

/** Defiende la invariante del CHECK del modelo de datos en el dominio. */
export const validateNewUser = (u: NewUser): NewUser => newUserSchema.parse(u);