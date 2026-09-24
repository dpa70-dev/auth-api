/**
 * Rol de usuario (doc 04 → users.role): eje de AUTORIZACIÓN, independiente de `kind`
 * (identidad) y del estado de moderación (feature aparte). `user` = default de creación;
 * `admin` se asigna vía el endpoint admin-only (solo un admin puede promover/degradar).
 */
import { z } from 'zod';

export const userRoleValues = ['user', 'admin'] as const;

export const userRoleSchema = z.enum(userRoleValues);

export type UserRole = z.infer<typeof userRoleSchema>;