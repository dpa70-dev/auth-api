/**
 * Contrato de repositorio de usuarios y refresh tokens. El dominio posee la semántica
 * (quién busca y qué transición de estado se ejecuta); la infraestructura, el SQL.
 *
 * Port deliberadamente GRANDE (decisión QA SOLID · doc 05): agrupa dos agregados del mismo
 * bounded context — usuario (findByEmail/findByGoogleSub/findById/createUser/markEmailVerified)
 * y refresh token (findByRefreshTokenHash/insertRefreshToken/markRefreshTokenUsed/
 * revokeRefreshToken/revokeFamily) — en UN solo contrato porque el refresh token pertenece al
 * usuario en este dominio (doc 04 → decisión 2: family_id = UUID de sesión por login). Tradeoff ISP aceptado: cada
 * use case recibe el port completo aunque use 2-3 métodos; segregarlo ahora sería
 * sobre-ingeniería a este tamaño. Si el dominio crece, separar AQUÍ (p. ej. RefreshTokenRepository)
 * sin tocar ni la entidad ni los use cases: solo desacoplar el puerto y el constructor inyectado.
 */
import type { Email, FamilyId, GoogleSub, Jti, PasswordHash, Provider, RefreshTokenStatus, Timestamp, UserId } from '../vo/index.js';
import type { NewUser, User } from '../entity/user.js';

export type InsertRefreshToken = {
  jti: Jti;
  tokenHash: string;
  userId: UserId;
  familyId: FamilyId;
  provider: Provider;
  expiresAt: Timestamp;
};

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
  findByRefreshTokenHash(tokenHash: string): Promise<{
    jti: Jti;
    tokenHash: string;
    userId: UserId;
    familyId: FamilyId;
    provider: Provider;
    status: RefreshTokenStatus;
    expiresAt: Timestamp;
  } | null>;
  /** Inserta usuario (NewUser con email nullable y kind: registrado o guest US-15); lanza Error si viola la unicidad de email o google_sub. */
  createUser(input: NewUser & { createdAt: Timestamp }): Promise<void>;
  insertRefreshToken(token: InsertRefreshToken): Promise<void>;
  /** SET status = 'used' (rotación, doc 02 → diagrama 3). */
  markRefreshTokenUsed(tokenHash: string): Promise<void>;
  /** SET status = 'revoked' (logout soft-revoke, doc 04 → decisión 3). */
  revokeRefreshToken(tokenHash: string): Promise<void>;
  /** Revoca TODA la familia de refresh (sessionId). */
  revokeFamily(familyId: FamilyId): Promise<void>;
  /** Revoca TODOS los refresh del usuario (cambio/reset de password — F1). */
  revokeAllForUser(userId: UserId): Promise<void>;
  /** SET email_verified = true (posesión de email probada vía magic link, doc 04 → decisión 5). */
  markEmailVerified(email: Email): Promise<void>;
  /** SET password_hash = nuevo (cambio de contraseña: US-11 change-password y US-12 reset vía magic link). */
  updatePasswordHash(userId: UserId, passwordHash: PasswordHash): Promise<void>;
}