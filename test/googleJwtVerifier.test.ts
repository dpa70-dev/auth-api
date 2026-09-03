/**
 * Tests de integración del GoogleIdTokenVerifierJose REAL (src/infra/googleJwtVerifier.ts).
 *
 * Técnica: JWKS local — createRemoteJWKSet(jwksUrl) fetchea la URL; en tests esa URL es un
 * server HTTP de juguete que sirve claves generadas aquí con jose. El 100% del código real se
 * ejecuta (fetch → JWKS → verificación RS256 → auditoría aud/iss → claims) sin mockear jose
 * ni tocar la red de Google. La criptografía es genuina.
 *
 * Doc 00 → ítem 44: reglas de verificación del ID token (aud, iss, exp/iat, RS256 fijo, JWKS).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { GoogleIdTokenVerifierJose } from '../src/infra/googleJwtVerifier.js';
import type { GoogleClaims } from '../src/domain/port/index.js';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const ISSUERS: [string, ...string[]] = ['https://accounts.google.com'];

let server: Server;
let kid: string;
let privateKey: CryptoKey;
let jwksUrl: string;

beforeAll(async () => {
  const { publicKey, privateKey: pk } = await generateKeyPair('RS256', { extractable: true });
  privateKey = pk;
  kid = `test-${crypto.randomUUID()}`;
  const jwk = await exportJWK(publicKey);
  jwk.kid = kid; // createRemoteJWKSet selecciona la clave por kid del JWS header
  jwk.alg = 'RS256';

  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  jwksUrl = `http://127.0.0.1:${port}/certs`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

/** Firma un ID token real (RS256) con claims y opciones de verificación. */
const signToken = (
  payload: Record<string, unknown>,
  opts: { issuer?: string; audience?: string | string[]; exp?: number } = {},
) =>
  new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(opts.issuer ?? ISSUERS[0])
    .setAudience(opts.audience ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? Math.floor(Date.now() / 1000) + 300)
    .sign(privateKey);

const verify = (token: string, expectedNonce?: string): Promise<GoogleClaims | null> =>
  new GoogleIdTokenVerifierJose(CLIENT_ID, ISSUERS, jwksUrl).verify(token, expectedNonce);

describe('GoogleIdTokenVerifierJose (verificador real)', () => {
  it('1. token válido → claims completos (sub, email, emailVerified)', async () => {
    const token = await signToken({
      sub: '107349295047130090256',
      email: 'Ana@Example.com', // el schema normaliza a minúsculas
      email_verified: true,
    });
    await expect(verify(token)).resolves.toEqual({
      sub: '107349295047130090256',
      email: 'ana@example.com',
      emailVerified: true,
    });
  });

  it('2. issuer distinto → null', async () => {
    const token = await signToken(
      { sub: '107349295047130090256', email: 'a@example.com', email_verified: true },
      { issuer: 'https://evil.example.com' },
    );
    await expect(verify(token)).resolves.toBeNull();
  });

  it('3. aud distinto al clientId → null', async () => {
    const token = await signToken(
      { sub: '107349295047130090256', email: 'a@example.com', email_verified: true },
      { audience: 'otro-client-id.apps.googleusercontent.com' },
    );
    await expect(verify(token)).resolves.toBeNull();
  });

  it('4. token expirado → null', async () => {
    const token = await signToken(
      { sub: '107349295047130090256', email: 'a@example.com', email_verified: true },
      { exp: Math.floor(Date.now() / 1000) - 3600 }, // exp en el pasado
    );
    await expect(verify(token)).resolves.toBeNull();
  });

  it('5. firma alterada (clave distinta) → null', async () => {
    const { privateKey: evilKey } = await generateKeyPair('RS256', { extractable: false });
    const token = await new SignJWT({
      sub: '107349295047130090256',
      email: 'a@example.com',
      email_verified: true,
    })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(ISSUERS[0])
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(evilKey); // misma forma, otra firma → la clave pública del JWKS no valida
    await expect(verify(token)).resolves.toBeNull();
  });

  it('6. email_verified: false → claims.emailVerified false (no null: el app layer decide)', async () => {
    const token = await signToken({
      sub: '107349295047130090256',
      email: 'b@example.com',
      email_verified: false,
    });
    await expect(verify(token)).resolves.toEqual({
      sub: '107349295047130090256',
      email: 'b@example.com',
      emailVerified: false,
    });
  });

  it('7. nonce en el JWT: válido solo si expectedNonce coincide (anti-replay), y NO se propaga a claims', async () => {
    const token = await signToken({
      sub: '107349295047130090256',
      email: 'c@example.com',
      email_verified: true,
      nonce: 'nonce-aleatorio-123',
    });
    // Nonce correcto → claims (sin nonce propagado: dato efímero de la transacción).
    await expect(verify(token, 'nonce-aleatorio-123')).resolves.toEqual({
      sub: '107349295047130090256',
      email: 'c@example.com',
      emailVerified: true,
    });
    // Nonce ausente en el body → replay → null.
    await expect(verify(token)).resolves.toBeNull();
    // Nonce distinto → replay → null.
    await expect(verify(token, 'nonce-distinto')).resolves.toBeNull();
  });

  it('8. aud como array conteniendo el clientId → válido', async () => {
    const token = await signToken(
      { sub: '107349295047130090256', email: 'd@example.com', email_verified: true },
      { audience: [CLIENT_ID, 'otro-aud.apps.googleusercontent.com'] },
    );
    await expect(verify(token)).resolves.toMatchObject({ email: 'd@example.com' });
  });

  it('9. input que no es JWT → null', async () => {
    await expect(verify('esto-no-es-un-jwt')).resolves.toBeNull();
  });

  it('10. email inválido → null (falla emailSchema.parse)', async () => {
    const token = await signToken({
      sub: '107349295047130090256',
      email: 'no-es-un-email',
      email_verified: true,
    });
    await expect(verify(token)).resolves.toBeNull();
  });
});