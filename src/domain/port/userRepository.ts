/**
 * Contrato de repositorio de usuarios (doc 00 → ítem 38).
 *
 * Port deliberadamente GRANDE (decisión QA SOLID · doc 05): agrupa dos agregados del mismo
 * bounded context — usuario (findByEmail/findByGoogleSub/findById/createUser/markEmailVerified)
 * y refresh token (findByRefreshTokenHash/insertRefreshToken/markRefreshTokenUsed/
 * revokeRefreshToken/revokeFamily) — en UN solo contrato porque el refresh token pertenece al
 * usuario en este dominio (doc 04 → decisión 2: family_id = UUID de sesión por login). Tradeoff ISP aceptado: cada
 * use case recibe el port completo aunque use 2-3 métodos; segregarlo ahora sería
 * sobre-ingeniería a este tamaño. Si el dominio crece, separar AQUÍ (p. ej. RefreshTokenRepository)
 * sin tocar ni la entidad ni los use cases: solo desacoplar el puerto y el constructor inyectado.
 * [REFACTOR 2025-09-23] Extraído RefreshTokenRepository (puerto + adaptador) — userRepository.ts ahora solo gestiona usuario.
 */
import type { Email, GoogleSub, PasswordHash, Timestamp, UserId } from '../vo/index.js';
import type { UserRole } from '../vo/index.js';
import type { UserStatus } from '../vo/index.js';
import type { NewUser, User } from '../entity/user.js';

/**
 * Lo que el repo devuelve al buscar un usuario: hoy coincide campo a campo con la entidad User.
 * Si la persistencia evoluciona (auditoría, JOINs, columnas propias), ESTE tipo se separa de User
 * para no filtrar detalles de almacenamiento al dominio — desacoplarlo aquí, no mutar la entidad.
 */
export type UserRecord = User;

export interface UserRepository {
  findByEmail(email: Email): Promise<UserRecord | null>;
  findByGoogleSub(sub: GoogleSub): Promise<UserRecord | null>;
  findById(id: UserId): Promise<UserRecord | null>;
  /** Inserta usuario (NewUser con email nullable y kind: registrado o guest US-15); lanza Error si viola la unicidad de email o google_sub. */
  createUser(input: NewUser & { createdAt: Timestamp }): Promise<void>;
  /** SET email_verified = true (posesión de email probada vía magic link, doc 04 → decisión 5). */
  markEmailVerified(email: Email): Promise<void>;
  /** SET password_hash = nuevo (cambio de contraseña: US-11 change-password y US-12 reset vía magic link). */
  updatePasswordHash(userId: UserId, passwordHash: PasswordHash): Promise<void>;
  /**
   * US-16: reclama identidad en una cuenta guest → SET email + password_hash + kind='registered'
   * (email_verified queda false → se verifica después vía magic link). **No revoca sesiones**
   * (decisión aprobada: el guest conserva acceso; el upgrade es sobre la misma cuenta).
   * Lanza Error si el email viola la unicidad de users.email (otra cuenta ya lo usa).
   */
  upgradeGuestToRegistered(userId: UserId, email: Email, passwordHash: PasswordHash): Promise<void>;
  /**
   * Eje de autorización (doc 04 → users.role): SET role. Solo el use case SetUserRole lo llama
   * (verifica actor admin y prohíbe auto-rol); el repo no sabe de políticas.
   */
  setRole(userId: UserId, role: UserRole): Promise<void>;
  /**
   * Eje de moderación (doc 04 → users.status): SET status del usuario. Solo el use case
   * SetUserModerationStatus lo llama (verifica actor admin); el repo no sabe de políticas.
   */
  setModerationStatus(userId: UserId, status: UserStatus): Promise<void>;
}