/**
 * Contrato de repositorio de OTP (doc 00 → ítem 34). El dominio posee la semántica
 * (quién busca, qué transición de estado se ejecuta); la infraestructura, el SQL.
 */
import type { Email, OtpStatus, PasswordHash, Timestamp } from '../vo/index.js';

export type OtpRecord = {
  id: string;
  email: Email;
  codeHash: PasswordHash;
  status: OtpStatus;
  attempts: number;
  expiresAt: Timestamp;
  createdAt: Timestamp;
};

export interface OtpRepository {
  /** Inserta un OTP pendiente (attempts = 0); lanza Error si viola la unicidad de id. */
  insert(input: {
    id: string;
    email: Email;
    codeHash: PasswordHash;
    expiresAt: Timestamp;
  }): Promise<void>;
  /** Busca un OTP pendiente por email (solo status 'pending' y no expirado). */
  findPendingByEmail(email: Email, nowIso: string): Promise<OtpRecord | null>;
  /** Revoca todos los OTP pendientes para un email (invalidar anteriores). */
  revokeAllForEmail(email: Email): Promise<void>;
  /** Marca un OTP con un nuevo status (used/revoked). */
  markStatus(id: string, status: OtpStatus): Promise<void>;
  /** Incrementa el contador de intentos de un OTP. */
  incrementAttempts(id: string): Promise<void>;
}
