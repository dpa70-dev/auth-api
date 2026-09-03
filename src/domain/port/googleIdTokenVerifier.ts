/** Contrato de verificación del ID token de Google (US-07, doc 00 → ítem 44). */
import type { Email, GoogleSub } from '../vo/index.js';

/** Claims verificados de un ID token de Google (US-07).
 * GoogleClaims representa los datos que se extraen del JWT de Google tras verificar su firma y validez
 * con la API de Google usando el clientId de la app en google y la allowlist de emisores (issuers).
 * El front obtiene el ID token (JWT) de Google tras la autenticación del usuario y lo pasa al back.
 * Contiene el identificador único (sub), el correo y su estado de verificación. El claim `nonce` NO se
 * propaga aquí: es un dato efímero de una transacción de login, se valida dentro del verifier contra el
 * `expectedNonce` del body y se descarta (su única misión es el anti-replay en el momento del login; la
 * sesión posterior usa nuestros access/refresh tokens con su propio mecanismo de reuso).
 */
export type GoogleClaims = {
  sub: GoogleSub; // identificador único del usuario en Google
  email: Email;
  emailVerified: boolean;
};

export interface GoogleIdTokenVerifier {
  /**
   * Verifica el ID token (firma RS256, aud/iss, exp/iat) y devuelve los claims, o null si inválido.
   * Anti-replay (nonce) condicional: si el JWT incluye el claim `nonce`, DEBE coincidir con
   * `expectedNonce` (si no → null); si el JWT no incluye `nonce`, `expectedNonce` se ignora.
   */
  verify(idToken: string, expectedNonce?: string): Promise<GoogleClaims | null>;
}