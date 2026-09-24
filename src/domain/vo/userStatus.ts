/**
 * Estado de la cuenta (doc 04 → users.status): eje de MODERACIÓN, independiente de `kind`
 * (identidad) y `role` (autorización). `active` = default de creación; `suspended`/`banned`
 * se asignan por un admin y bloquean la emisión de sesiones (403) + revocan las activas.
 *
 * No colisiona con los estados de token: cada tabla tiene su propio VO
 * (RefreshTokenStatus, MagicLinkStatus, OtpStatus) — `users.status` es del usuario.
 */
import { z } from 'zod';

export const userStatusValues = ['active', 'suspended', 'banned'] as const;

export const userStatusSchema = z.enum(userStatusValues);

export type UserStatus = z.infer<typeof userStatusSchema>;