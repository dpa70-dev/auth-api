/** Contrato de hashing de contraseñas (doc 00 → ítem 35: argon2id). */
import type { PasswordHash, PlainPassword } from '../vo/index.js';

export interface PasswordHasher {
  hash(plain: PlainPassword): Promise<PasswordHash>;
  verify(plain: PlainPassword, hash: PasswordHash | null): Promise<boolean>;
}