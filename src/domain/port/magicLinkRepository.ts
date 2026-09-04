/**
 * Contrato de repositorio de magic links (doc 04 → magic_links). El dominio posee la semántica
 * (quién busca, qué transición de estado se ejecuta); la infraestructura, el SQL.
 */
import type { Email, MagicLinkStatus, Timestamp } from '../vo/index.js';

export type MagicLinkRecord = {
  id: string;
  tokenHash: string;
  email: Email;
  status: MagicLinkStatus;
  expiresAt: Timestamp;
};

export interface MagicLinkRepository {
  /** Inserta un magic link pendiente; lanza Error si viola la unicidad de token_hash. */
  insert(input: {
    id: string;
    tokenHash: string;
    email: Email;
    expiresAt: Timestamp;
  }): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<MagicLinkRecord | null>;
  /** SET status = 'used' (consumo, un solo uso). */
  markUsed(tokenHash: string): Promise<void>;
  /** SET status = 'revoked' para TODOS los pending de un email (invalidar links anteriores). */
  revokeAllForEmail(email: Email): Promise<void>;
}
