/** Contrato de emisión/verificación de tokens (doc 00 → ítems 36-38). */
import type { Jti, UserId } from '../vo/index.js';

export type AccessTokenPayload = {
  sub: string;
  iat: number;
  exp: number;
};

export interface TokenIssuer {
  /** Emite el access token JWT HS256 con claims sub (users.id) y exp (5-15 min). */
  issueAccessToken(userId: UserId, now?: Date): Promise<string>;
  /** Verifica un access token; devuelve el userId o null si es inválido/vencido. */
  verifyAccessToken(token: string): Promise<AccessTokenPayload | null>;
  /** Crea un refresh opaco nuevo (no-JWT) con su jti. */
  issueRefreshToken(now?: Date): Promise<{ rawToken: string; jti: Jti }>;
  /** SHA-256 del refresh opaco — lo único que se persiste (doc 00 → ítem 38). */
  hashRefreshToken(rawToken: string): Promise<string>;
}