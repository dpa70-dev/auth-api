import argon2 from 'argon2';
import type { PasswordHasher } from '../../domain/port/index.js';
import type { PasswordHash, PlainPassword } from '../../domain/vo/index.js';

/**
 * parÁmetros OWASP min-interactive para argon2id (doc 00 → ítem 43):
 * m=19456 KiB (19 MiB), t=2 iteraciones, p=1 hilo.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

// Hash ficticio (doc 00 → ítem 41, US-02): mismo coste de cómputo para email inexistente.
let fakeHashPromise: Promise<PasswordHash> | null = null;
const fakeHash = (): Promise<PasswordHash> =>
  (fakeHashPromise ??= argon2.hash('ficticio-para-tiempo-constante', ARGON2_OPTIONS));

export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plain: PlainPassword): Promise<PasswordHash> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  async verify(plain: PlainPassword, hash: PasswordHash | null): Promise<boolean> {
    // hash nulo = email inexistente → mismo coste antes de devolver false (anti-enumeración).
    const target = hash ?? (await fakeHash());
    try {
      return await argon2.verify(target, plain);
    } catch {
      return false;
    }
  }
}