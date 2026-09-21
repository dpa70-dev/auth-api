import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { AccessTokenPayload, TokenIssuer } from '../../domain/port/index.js';
import { jtiSchema, type Jti, type UserId } from '../../domain/vo/index.js';

export class JoseTokenService implements TokenIssuer {
  constructor(
    private readonly secret: Uint8Array,
    private readonly accessTtlMinutes: number,
  ) {}

  async issueAccessToken(userId: UserId, now?: Date): Promise<string> {
    const { iat, exp } = this.interval(now);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.secret);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ['HS256'] });
      const sub = payload.sub;
      if (typeof sub !== 'string' || sub.length === 0) return null;
      // jwtVerify ya valida la expiración (rechaza el token si exp falta o venció). Los claims
      // iat/exp son emitidos siempre por issueAccessToken; si por defensa no fuesen números, no
      // fabricamos valores que el emisor no firmó — devolvemos null (token inválido), igual que sub.
      if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
      return { sub, iat: payload.iat, exp: payload.exp };
    } catch {
      return null;
    }
  }

  async issueRefreshToken(): Promise<{ rawToken: string; jti: Jti }> {
    // Token opaco (doc 00 → ítem 38): 32 bytes aleatorios, no-JWT, solo legible por hash SHA-256.
    const rawToken = randomBytes(32).toString('base64url');
    const jti = jtiSchema.parse(randomUUID());
    return { rawToken, jti };
  }

  async hashRefreshToken(rawToken: string): Promise<string> {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private interval(now?: Date): { iat: number; exp: number } {
    const iat = Math.floor((now ?? new Date()).getTime() / 1000);
    return { iat, exp: iat + this.accessTtlMinutes * 60 };
  }
}