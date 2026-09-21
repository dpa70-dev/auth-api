import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { GoogleClaims, GoogleIdTokenVerifier } from '../../domain/port/index.js';
import { emailSchema, googleSubSchema } from '../../domain/vo/index.js';

/**
 * US-07 AC-03: verificación estrictamente server-side del ID token de Google.
 * jose verifica firma RS256 + exp/iat contra el JWKS público; aquí se auditan
 * aud/iss y se extraen los claims ya validados (el dominio recibe claims, no el token).
 * Anti-replay (nonce): si el JWT incluye el claim `nonce`, se compara contra el `expectedNonce`
 * del body — el nonce es un dato efímero de la transacción de login y NO se propaga a los claims.
 * clientId, allowlist de emisores y JWKS se inyectan desde la config (doc 00 → ítems 43-47).
 */
export class GoogleIdTokenVerifierJose implements GoogleIdTokenVerifier {
  private readonly keys: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly clientId: string,
    private readonly issuers: string[],
    jwksUrl: string,
  ) {
    this.keys = createRemoteJWKSet(new URL(jwksUrl));
  }

  async verify(idToken: string, expectedNonce?: string): Promise<GoogleClaims | null> {
    try {
      const { payload } = await jwtVerify(idToken, this.keys, {
        algorithms: ['RS256'],
        audience: this.clientId,
        issuer: this.issuers,
      });
      if (!this.isValidAud(payload.aud)) return null;
      // Anti-replay condicional (US-07 AC-03, doc 03 → GoogleRequest.nonce): si Google emitió un
      // nonce en el JWT, el body debe traerlo y coincidir; si no, el token es un replay → null.
      if (typeof payload.nonce === 'string' && payload.nonce !== expectedNonce) return null;
      const sub = googleSubSchema.parse(payload.sub);
      const email = emailSchema.parse(payload.email);
      const claims: GoogleClaims = {
        sub,
        email,
        emailVerified: payload.email_verified === true,
      };
      return claims;
    } catch {
      return null;
    }
  }

  private isValidAud(aud: unknown): boolean {
    // aud puede ser string o string[] según el emisor; cualquiera debe contener clientId.
    return typeof aud === 'string'
      ? aud === this.clientId
      : Array.isArray(aud) && aud.includes(this.clientId);
  }
}