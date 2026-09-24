/**
 * Puerto de repositorio de refresh tokens (doc 00 → ítem 38).
 *
 * Port deliberadamente SEPARADO de UserRepository (decisión QA SOLID · doc 05): el refresh token
 * pertenece al usuario en este dominio (family_id = UUID de sesión por login), pero el agregado
 * de refresh token es una responsabilidad distinta — el split está predicho por el header de
 * userRepository.ts:5-12 (si el dominio crece, separar AQUÍ). Esto permite cambiar el
 * proveedor de refresh (SQLite → Postgres) sin modificar el core de usuario.
 */
import type { FamilyId, Jti, Provider, RefreshTokenStatus, Timestamp, UserId } from '../vo/index.js';

export type InsertRefreshToken = {
  jti: Jti;
  tokenHash: string;
  userId: UserId;
  familyId: FamilyId;
  provider: Provider;
  expiresAt: Timestamp;
};

/**
 * Lo que el repo devuelve al buscar un refresh token: shape extraído del inline de
 * findByRefreshTokenHash en userRepository.ts:37-45 y el RefreshRecord local de
 * drizzleUserRepository.ts:131.
 */
export type RefreshRecord = {
  jti: Jti;
  tokenHash: string;
  userId: UserId;
  familyId: FamilyId;
  provider: Provider;
  status: RefreshTokenStatus;
  expiresAt: Timestamp;
};

export interface RefreshTokenRepository {
  /** Busca un refresh token por su hash SHA-256 (doc 00 → ítem 38). */
  findByRefreshTokenHash(tokenHash: string): Promise<RefreshRecord | null>;
  /** Inserta un nuevo refresh token (doc 00 → ítem 38). */
  insertRefreshToken(token: InsertRefreshToken): Promise<void>;
  /** SET status = 'used' (rotación, doc 02 → diagrama 3). */
  markRefreshTokenUsed(tokenHash: string): Promise<void>;
  /** SET status = 'revoked' (logout soft-revoke, doc 04 → decisión 3). */
  revokeRefreshToken(tokenHash: string): Promise<void>;
  /** Revoca TODA la familia de refresh (sessionId). */
  revokeFamily(familyId: FamilyId): Promise<void>;
  /** Revoca TODOS los refresh del usuario (cambio/reset de password — F1). */
  revokeAllForUser(userId: UserId): Promise<void>;
}