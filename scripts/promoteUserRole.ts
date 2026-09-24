import type { UserRepository } from '../src/domain/port/index.js';
import { emailSchema, userRoleSchema, type Email, type UserId, type UserRole } from '../src/domain/vo/index.js';

export type PromoteUserRoleInput = {
  /** Email objetivo tal cual lo pasa el operador (se normaliza con emailSchema igual que la API). */
  email: string;
  /** Rol deseado: 'admin' (default) o 'user'. */
  role?: string;
  /** true = reportar el cambio sin ejecutar el UPDATE (ensayo de operación). */
  dryRun: boolean;
};

export type PromoteUserRoleResult =
  | { kind: 'invalid-email'; email: string }
  | { kind: 'invalid-role'; role: string }
  | { kind: 'not-found'; email: string }
  | { kind: 'noop'; email: Email; role: UserRole; userId: UserId }
  | { kind: 'applied'; email: Email; role: UserRole; from: UserRole; userId: UserId; dryRun: boolean };

/**
 * Promueve/degrada el rol de un usuario existente — lógica pura sobre el puerto UserRepository
 * (DIP): la promoción no conoce SQLite ni el contrato HTTP (es el bootstrap fuera de la API que
 * luego `PATCH /admin/users/{id}/role` gestiona con guards). El runner de CLI resuelve el adaptador.
 */
export const promoteUserRole = async (users: UserRepository, input: PromoteUserRoleInput): Promise<PromoteUserRoleResult> => {
  const email = emailSchema.safeParse(input.email);
  if (!email.success) return { kind: 'invalid-email', email: input.email };

  const role = userRoleSchema.safeParse(input.role ?? 'admin');
  if (!role.success) return { kind: 'invalid-role', role: input.role ?? 'admin' };

  const found = await users.findByEmail(email.data);
  if (!found) return { kind: 'not-found', email: email.data };

  if (found.role === role.data) return { kind: 'noop', email: email.data, role: role.data, userId: found.id };

  if (!input.dryRun) await users.setRole(found.id, role.data);
  return { kind: 'applied', email: email.data, role: role.data, from: found.role, userId: found.id, dryRun: input.dryRun };
};