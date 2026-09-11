import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Server } from 'node:http';
import { buildApp } from '../src/index.js';
import type { CompromisedPasswordChecker, GoogleClaims, GoogleIdTokenVerifier, Logger } from '../src/domain/port/index.js';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };
/** Screen falso: ninguna contraseña está comprometida (los tests no pueden depender de la red). */
const noOpCompromisedChecker: CompromisedPasswordChecker = { check: async () => 'clean' };

// Formas del envelope del contrato docs/03 (éxito/error) para tipar las respuestas JSON.
type AuthData = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; createdAt: string };
};
type MeData = { id: string; email: string; createdAt: string };
type ErrorIssue = { field: string; issue: string };
type ErrorData = { code: string; message: string; requestId: string; details?: ErrorIssue[] };
/** @types/node 26 tipa Response.json() como Promise<unknown> — cast al modelo del contrato. */
const readJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

class FakeGoogleVerifier implements GoogleIdTokenVerifier {
  constructor(
    private readonly claims: GoogleClaims | null,
    /** nonce que el ID token "real" incluiría; si se define, simula el anti-replay del verifier real. */
    private readonly tokenNonce?: string,
  ) {}
  async verify(_idToken: string, expectedNonce?: string): Promise<GoogleClaims | null> {
    if (this.tokenNonce !== undefined && expectedNonce !== this.tokenNonce) return null;
    return this.claims;
  }
}

type TestContext = { baseUrl: string; close: () => Promise<void> };

const startApp = async (google: GoogleIdTokenVerifier | null = null): Promise<TestContext> => {
  const db = new Database(':memory:');
  const { app, close } = buildApp({ db, google, logger: silentLogger, compromised: noOpCompromisedChecker });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          close();
          resolve();
        });
      }),
  };
};

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const get = (url: string, token?: string, headers: Record<string, string> = {}) =>
  fetch(url, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });

let ctx: TestContext;
beforeEach(async () => {
  ctx = await startApp();
});
afterEach(async () => {
  await ctx.close();
});

describe('US-01 — registro local', () => {
  it('201 con par de tokens y perfil público (AC-01/AC-02)', async () => {
    const res = await post(`${ctx.baseUrl}/auth/register`, { email: 'Ana@Example.com', password: 'contraseñaSegura123' });
    expect(res.status).toBe(201);
    const { data } = await readJson<{ data: AuthData }>(res);
    expect(data.accessToken).toMatch(/^eyJ/);
    expect(typeof data.refreshToken).toBe('string');
    expect(data.user.email).toBe('ana@example.com');
    expect(data.user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(data.user.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('422 VALIDATION_ERROR con details por campo (email inválido + password corta)', async () => {
    const res = await post(`${ctx.baseUrl}/auth/register`, { email: 'no-es-email', password: 'corta' });
    expect(res.status).toBe(422);
    const { error } = await readJson<{ error: ErrorData }>(res);
    expect(error.code).toBe('VALIDATION_ERROR');
    const fields = (error.details ?? []).map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('409 EMAIL_ALREADY_EXISTS en el segundo registro del mismo email (US-08 AC-01)', async () => {
    await post(`${ctx.baseUrl}/auth/register`, { email: 'a@example.com', password: 'contraseñaSegura123' });
    const res = await post(`${ctx.baseUrl}/auth/register`, { email: 'a@example.com', password: 'otraContraseña9' });
    expect(res.status).toBe(409);
    const { error } = await readJson<{ error: ErrorData }>(res);
    expect(error.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(error.details).toEqual([{ field: 'provider', issue: 'local' }]);
  });

  it('400 MALFORMED_REQUEST con body que no es JSON', async () => {
    const res = await fetch(`${ctx.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{no-es-json',
    });
    expect(res.status).toBe(400);
    const { error } = await readJson<{ error: ErrorData }>(res);
    expect(error.code).toBe('MALFORMED_REQUEST');
  });

  it('404 NOT_FOUND para rutas no declaradas en el contrato', async () => {
    const res = await get(`${ctx.baseUrl}/auth/inexistente`);
    expect(res.status).toBe(404);
    const { error } = await readJson<{ error: ErrorData }>(res);
    expect(error.code).toBe('NOT_FOUND');
  });

  it('405 METHOD_NOT_ALLOWED para método no declarado en una ruta existente', async () => {
    const res = await get(`${ctx.baseUrl}/auth/register`);
    expect(res.status).toBe(405);
    const { error } = await readJson<{ error: ErrorData }>(res);
    expect(error.code).toBe('METHOD_NOT_ALLOWED');
  });

  // El trailing slash no es un caso especial de /auth/me: strict routing off hace que
  // Express ignore el slash al matchear handlers, pero el middleware 405 lo recibe intacto
  // en req.path. El fix normaliza el path en TODAS las rutas → método equivocado + '/'
  // siempre da 405 (nunca cae a 404).
  it.each([
    ['GET', '/auth/register/'],
    ['GET', '/auth/login/'],
    ['GET', '/auth/refresh/'],
    ['GET', '/auth/logout/'],
    ['GET', '/auth/google/'],
    ['GET', '/auth/magic-link/request/'],
    ['GET', '/auth/magic-link/consume/'],
    ['POST', '/auth/me/'],
  ])('405 METHOD_NOT_ALLOWED con trailing slash: %s %s → 405, no 404', async (method, path) => {
    const res = await fetch(`${ctx.baseUrl}${path}`, { method });
    expect(res.status).toBe(405);
    const { error } = await readJson<{ error: ErrorData }>(res);
    expect(error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('404 con trailing slash en ruta inexistente (la normalización no la inventa)', async () => {
    const res = await get(`${ctx.baseUrl}/auth/inexistente/`);
    expect(res.status).toBe(404);
    const { error } = await readJson<{ error: ErrorData }>(res);
    expect(error.code).toBe('NOT_FOUND');
  });
});

describe('US-02 — login local (anti-enumeración)', () => {
  it('200 con par de tokens y perfil público (AC-01/AC-05)', async () => {
    await post(`${ctx.baseUrl}/auth/register`, { email: 'luis@example.com', password: 'contraseñaSegura123' });
    const res = await post(`${ctx.baseUrl}/auth/login`, { email: 'luis@example.com', password: 'contraseñaSegura123' });
    expect(res.status).toBe(200);
    const { data } = await readJson<{ data: AuthData }>(res);
    expect(data.accessToken).toMatch(/^eyJ/);
    expect(data.user.email).toBe('luis@example.com');
  });

  it('401 INVALID_CREDENTIALS idéntico para email inexistente y contraseña equivocada (AC-02/AC-03)', async () => {
    await post(`${ctx.baseUrl}/auth/register`, { email: 'ana@example.com', password: 'contraseñaSegura123' });
    // Mismo x-request-id en ambos: los cuerpos completos (incluido requestId) deben ser idénticos.
    const commonHeaders = { 'x-request-id': 'req_anti_enum_01' };
    const [r1, r2] = await Promise.all([
      post(`${ctx.baseUrl}/auth/login`, { email: 'no-existe@example.com', password: 'x'.repeat(12) }, commonHeaders),
      post(`${ctx.baseUrl}/auth/login`, { email: 'ana@example.com', password: 'contraseñaEquivocada' }, commonHeaders),
    ]);
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    const e1 = await readJson<{ error: ErrorData }>(r1);
    const e2 = await readJson<{ error: ErrorData }>(r2);
    expect(e1.error.code).toBe('INVALID_CREDENTIALS');
    expect(e1.error).toEqual(e2.error); // mismo código, mismo mensaje, misma forma, mismo requestId
  });

  it('401 genérico si la cuenta es solo-Google (US-08 AC-04, nunca revelar colisión)', async () => {
    const local = await startApp(
      new FakeGoogleVerifier({
        sub: 'google-sub-1',
        email: 'carol@gmail.com',
        emailVerified: true,
      }),
    );
    try {
      await post(`${local.baseUrl}/auth/google`, { idToken: 'fake' });
      const res = await post(`${local.baseUrl}/auth/login`, {
        email: 'carol@gmail.com',
        password: 'contraseñaSegura123',
      });
      expect(res.status).toBe(401);
      const { error } = await readJson<{ error: ErrorData }>(res);
      expect(error.code).toBe('INVALID_CREDENTIALS');
    } finally {
      await local.close();
    }
  });
});

describe('US-03 — refresh con rotación y reuso', () => {
  it('200 con par NUEVO y el refresh usado queda invalidado (AC-01/AC-02)', async () => {
    const reg = await post(`${ctx.baseUrl}/auth/register`, { email: 'r@example.com', password: 'contraseñaSegura123' });
    const { data: first } = await readJson<{ data: AuthData }>(reg);

    const res = await post(`${ctx.baseUrl}/auth/refresh`, { refreshToken: first.refreshToken });
    expect(res.status).toBe(200);
    const { data: rotated } = await readJson<{ data: AuthData }>(res);
    expect(rotated.accessToken).toMatch(/^eyJ/);
    expect(rotated.refreshToken).not.toBe(first.refreshToken);

    // El token original ya fue usado → reuso: 401 Y revoca toda la familia (AC-03).
    const reuse = await post(`${ctx.baseUrl}/auth/refresh`, { refreshToken: first.refreshToken });
    expect(reuse.status).toBe(401);
    expect((await readJson<{ error: ErrorData }>(reuse)).error.code).toBe('UNAUTHORIZED');
  });

  it('401 genérico para refresh inexistente/vencido (AC-04)', async () => {
    const res = await post(`${ctx.baseUrl}/auth/refresh`, { refreshToken: 'v4.local.token-inventado' });
    expect(res.status).toBe(401);
    expect((await readJson<{ error: ErrorData }>(res)).error.code).toBe('UNAUTHORIZED');
  });

  it('reuso → revoca el refresh NUEVO de la misma familia', async () => {
    const reg = await post(`${ctx.baseUrl}/auth/register`, { email: 'fam@example.com', password: 'contraseñaSegura123' });
    const { data: first } = await readJson<{ data: AuthData }>(reg);
    const rot = await post(`${ctx.baseUrl}/auth/refresh`, { refreshToken: first.refreshToken });
    const { data: second } = await readJson<{ data: AuthData }>(rot);

    await post(`${ctx.baseUrl}/auth/refresh`, { refreshToken: first.refreshToken }); // dispara reuso

    const afterReuse = await post(`${ctx.baseUrl}/auth/refresh`, { refreshToken: second.refreshToken });
    expect(afterReuse.status).toBe(401); // la familia completa murió
  });
});

describe('US-04 — logout soft-revoke', () => {
  it('204 y el refresh revocado ya no sirve (AC-01 + doc 04 → decisión 3)', async () => {
    const reg = await post(`${ctx.baseUrl}/auth/register`, { email: 'logout@example.com', password: 'contraseñaSegura123' });
    const { data } = await readJson<{ data: AuthData }>(reg);

    const out = await post(`${ctx.baseUrl}/auth/logout`, { refreshToken: data.refreshToken });
    expect(out.status).toBe(204);

    const after = await post(`${ctx.baseUrl}/auth/refresh`, { refreshToken: data.refreshToken });
    expect(after.status).toBe(401);
    expect((await readJson<{ error: ErrorData }>(after)).error.code).toBe('UNAUTHORIZED');
  });
});

describe('US-05 — GET protegido /auth/me', () => {
  it('200 con perfil del propio token (AC-01/AC-04)', async () => {
    const reg = await post(`${ctx.baseUrl}/auth/register`, { email: 'me@example.com', password: 'contraseñaSegura123' });
    const { data } = await readJson<{ data: AuthData }>(reg);

    const res = await get(`${ctx.baseUrl}/auth/me`, data.accessToken);
    expect(res.status).toBe(200);
    const body = await readJson<{ data: MeData }>(res);
    expect(body.data).toEqual({ id: body.data.id, email: 'me@example.com', createdAt: body.data.createdAt });
    expect(body.data.email).toBe('me@example.com');
  });

it('401 idéntico sin token, con token malformado y con token aleatorio', async () => {
    // Mismo x-request-id: sin token y token inválido deben producir cuerpos 401 idénticos.
    const missing = await get(`${ctx.baseUrl}/auth/me`, undefined, { 'x-request-id': 'req_unauth_01' });
    expect(missing.status).toBe(401);

    const malformed = await get(`${ctx.baseUrl}/auth/me`, 'no-es-un-jwt');
    expect(malformed.status).toBe(401);

    const random = await get(`${ctx.baseUrl}/auth/me`, 'eyJhbGciOiJIUzI1NiJ9.firma-inventada', { 'x-request-id': 'req_unauth_01' });
    expect(random.status).toBe(401);

    const e1 = await readJson<{ error: ErrorData }>(missing);
    const e2 = await readJson<{ error: ErrorData }>(random);
    expect(e1.error).toEqual(e2.error); // anti-enumeración: misma forma para ausente/inválido
  });
});

describe('US-07/US-08 — Google OIDC', () => {
  it('primer inicio = alta implícita con email_verified (US-07 AC-01/AC-02)', async () => {
    const g = await startApp(
      new FakeGoogleVerifier({ sub: 'gsub-1', email: 'gabriel@gmail.com', emailVerified: true }),
    );
    try {
      const res = await post(`${g.baseUrl}/auth/google`, { idToken: 'token-firme' });
      expect(res.status).toBe(200);
      const { data } = await readJson<{ data: AuthData }>(res);
      expect(data.user.email).toBe('gabriel@gmail.com');
      expect(data.user.id).toMatch(/^[0-9a-f]{8}-/);

      const again = await post(`${g.baseUrl}/auth/google`, { idToken: 'token-firme' });
      expect(again.status).toBe(200); // reconoce por google_sub, no duplica
    } finally {
      await g.close();
    }
  });

  it('401 EMAIL_NOT_VERIFIED si email_verified no es true (AC-04)', async () => {
    const g = await startApp(
      new FakeGoogleVerifier({ sub: 'gsub-2', email: 'sospechoso@gmail.com', emailVerified: false }),
    );
    try {
      const res = await post(`${g.baseUrl}/auth/google`, { idToken: 'token-firme' });
      expect(res.status).toBe(401);
      expect((await readJson<{ error: ErrorData }>(res)).error.code).toBe('EMAIL_NOT_VERIFIED');
    } finally {
      await g.close();
    }
  });

  it('401 UNAUTHORIZED si la verificación server-side falla (AC-03)', async () => {
    const g = await startApp(new FakeGoogleVerifier(null));
    try {
      const res = await post(`${g.baseUrl}/auth/google`, { idToken: 'token-falso' });
      expect(res.status).toBe(401);
      expect((await readJson<{ error: ErrorData }>(res)).error.code).toBe('UNAUTHORIZED');
    } finally {
      await g.close();
    }
  });

  it('anti-replay: nonce del body debe coincidir con el del ID token (AC-03)', async () => {
    const g = await startApp(
      new FakeGoogleVerifier(
        { sub: 'gsub-nonce', email: 'nonce@gmail.com', emailVerified: true },
        'nonce-esperado-123',
      ),
    );
    try {
      // Nonce correcto → login OK.
      const ok = await post(`${g.baseUrl}/auth/google`, {
        idToken: 'token-con-nonce',
        nonce: 'nonce-esperado-123',
      });
      expect(ok.status).toBe(200);
      expect((await readJson<{ data: AuthData }>(ok)).data.user.email).toBe('nonce@gmail.com');

      // Nonce ausente o distinto → 401 UNAUTHORIZED (replay).
      const sinNonce = await post(`${g.baseUrl}/auth/google`, { idToken: 'token-con-nonce' });
      expect(sinNonce.status).toBe(401);
      expect((await readJson<{ error: ErrorData }>(sinNonce)).error.code).toBe('UNAUTHORIZED');

      const nonceMalo = await post(`${g.baseUrl}/auth/google`, {
        idToken: 'token-con-nonce',
        nonce: 'nonce-incorrecto',
      });
      expect(nonceMalo.status).toBe(401);
      expect((await readJson<{ error: ErrorData }>(nonceMalo)).error.code).toBe('UNAUTHORIZED');
    } finally {
      await g.close();
    }
  });

  it('409 EMAIL_ALREADY_EXISTS si el email ya es local, sin auto-linking (US-08 AC-02)', async () => {
    const g = await startApp(
      new FakeGoogleVerifier({ sub: 'gsub-3', email: 'colision@example.com', emailVerified: true }),
    );
    try {
      // Alta local en la MISMA app (misma DB) que hará el Google login.
      const local = await post(`${g.baseUrl}/auth/register`, {
        email: 'colision@example.com',
        password: 'contraseñaSegura123',
      });
      expect(local.status).toBe(201);

      const res = await post(`${g.baseUrl}/auth/google`, { idToken: 'token-firme' });
      expect(res.status).toBe(409);
      const { error } = await readJson<{ error: ErrorData }>(res);
      expect(error.code).toBe('EMAIL_ALREADY_EXISTS');
      expect(error.details).toEqual([{ field: 'provider', issue: 'local' }]);
    } finally {
      await g.close();
    }
  });

  it('409 ACCOUNT_EXISTS_WITH_GOOGLE si el email ya es Google, al intentar registro local (US-08 AC-01)', async () => {
    const g = await startApp(
      new FakeGoogleVerifier({ sub: 'gsub-4', email: 'inverso@example.com', emailVerified: true }),
    );
    try {
      await post(`${g.baseUrl}/auth/google`, { idToken: 'token-firme' });
      const res = await post(`${g.baseUrl}/auth/register`, {
        email: 'inverso@example.com',
        password: 'contraseñaSegura123',
      });
      expect(res.status).toBe(409);
      const { error } = await readJson<{ error: ErrorData }>(res);
      expect(error.code).toBe('ACCOUNT_EXISTS_WITH_GOOGLE');
      expect(error.details).toEqual([{ field: 'provider', issue: 'google' }]);
    } finally {
      await g.close();
    }
  });
});

describe('Transversal — rate limit, requestId, envelope', () => {
  it('todos los errores llevan requestId y el envelope {error}', async () => {
    const res = await post(`${ctx.baseUrl}/auth/login`, { email: 'x@example.com', password: 'x'.repeat(10) });
    const { error } = await readJson<{ error: ErrorData }>(res);
    expect(res.status).toBe(401);
    expect(typeof error.requestId).toBe('string');
    expect(error.requestId).toMatch(/^req_/);
  });

  it('429 RATE_LIMITED con Retry-After tras exceder el límite de /auth', async () => {
    const fresh = await startApp();
    try {
      let lastStatus = 0;
      for (let i = 0; i < Number(process.env.RATE_LIMIT_AUTH_MAX) + 2; i++) {
        const res = await post(`${fresh.baseUrl}/auth/login`, { email: 'x@example.com', password: 'x'.repeat(10) });
        lastStatus = res.status;
        if (res.status === 429) {
          expect(res.headers.get('retry-after')).toBeTruthy();
          break;
        }
      }
      expect(lastStatus).toBe(429);
    } finally {
      await fresh.close();
    }
  });

  it('requestId del cliente se preserva (x-request-id)', async () => {
    const res = await post(
      `${ctx.baseUrl}/auth/login`,
      { email: 'x@example.com', password: 'x'.repeat(10) },
      { 'x-request-id': 'req_cliente_01' },
    );
    const { error } = await readJson<{ error: ErrorData }>(res);
    expect(error.requestId).toBe('req_cliente_01');
  });
});

describe('Transversal — transporte por cookie (docs/06 §3)', () => {
  /** Extrae el valor de `refresh_token=` de un array Set-Cookie (formato de `headers.getSetCookie()`). */
  const cookieValue = (setCookies: string[]): string | undefined =>
    setCookies.find((c) => c.startsWith('refresh_token='))?.split(';')[0]?.slice('refresh_token='.length);

  it('register/login setean cookie httpOnly y devuelven el par por body (emisión dual)', async () => {
    const email = 'cookie1@example.com';
    const reg = await post(`${ctx.baseUrl}/auth/register`, { email, password: 'contraseñaSegura123' });
    const regCookies = reg.headers.getSetCookie();
    const regCookie = regCookies.find((c) => c.startsWith('refresh_token='));
    expect(regCookie).toBeDefined();
    expect(regCookie).toContain('HttpOnly');
    expect(regCookie).toContain('SameSite=Lax');
    expect(regCookie).toContain('Path=/api/v1/auth');
    expect(regCookie).not.toContain('Secure'); // test: nodeEnv no es production
    const regBody = await readJson<{ data: AuthData }>(reg);
    expect(regBody.data.refreshToken).toBeTruthy(); // emisión dual: el body también lo lleva

    const log = await post(`${ctx.baseUrl}/auth/login`, { email, password: 'contraseñaSegura123' });
    const logCookie = log.headers.getSetCookie().find((c) => c.startsWith('refresh_token='));
    expect(logCookie).toBeDefined();
    const logBody = await readJson<{ data: AuthData }>(log);
    expect(logBody.data.refreshToken).toBeTruthy();
  });

  it('refresh SOLO con cookie (sin body) → 200 con par nuevo', async () => {
    const reg = await post(`${ctx.baseUrl}/auth/register`, { email: 'cookie2@example.com', password: 'contraseñaSegura123' });
    const refresh = cookieValue(reg.headers.getSetCookie());
    expect(refresh).toBeDefined();

    const res = await fetch(`${ctx.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `refresh_token=${refresh}` }, // sin body ni Content-Type
    });
    expect(res.status).toBe(200);
    const { data } = await readJson<{ data: AuthData }>(res);
    expect(data.accessToken).toMatch(/^eyJ/);
    expect(data.refreshToken).not.toBe(refresh);
  });

  it('prioridad de cookie: cookie válida + body con token inválido → 200', async () => {
    const reg = await post(`${ctx.baseUrl}/auth/register`, { email: 'cookie3@example.com', password: 'contraseñaSegura123' });
    const refresh = cookieValue(reg.headers.getSetCookie());
    expect(refresh).toBeDefined();

    const res = await post(
      `${ctx.baseUrl}/auth/refresh`,
      { refreshToken: 'v4.local.token-inventado' },
      { cookie: `refresh_token=${refresh}` },
    );
    expect(res.status).toBe(200); // la cookie manda, el body inválido se ignora
  });

  it('logout con cookie → 204 + cookie expirada; reuso de esa cookie → 401', async () => {
    const reg = await post(`${ctx.baseUrl}/auth/register`, { email: 'cookie4@example.com', password: 'contraseñaSegura123' });
    const refresh = cookieValue(reg.headers.getSetCookie());
    expect(refresh).toBeDefined();

    const out = await fetch(`${ctx.baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { cookie: `refresh_token=${refresh}` },
    });
    expect(out.status).toBe(204);
    const cleared = out.headers.getSetCookie().find((c) => c.startsWith('refresh_token='));
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970'); // la cookie expira en el navegador

    const reuse = await fetch(`${ctx.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `refresh_token=${refresh}` },
    });
    expect(reuse.status).toBe(401);
    expect((await readJson<{ error: ErrorData }>(reuse)).error.code).toBe('UNAUTHORIZED');
  });

  it('refresh/logout SIN cookie y SIN body → 401 UNAUTHORIZED, nunca 400 (anti-enumeración)', async () => {
    const res = await fetch(`${ctx.baseUrl}/auth/refresh`, { method: 'POST' }); // req.body === undefined
    expect(res.status).toBe(401);
    const { error } = await readJson<{ error: ErrorData }>(res);
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.requestId).toMatch(/^req_/);

    const out = await fetch(`${ctx.baseUrl}/auth/logout`, { method: 'POST' });
    expect(out.status).toBe(401);
  });

  it('me con access en cookie y SIN Authorization → 401 idéntico al sin-token', async () => {
    const reg = await post(`${ctx.baseUrl}/auth/register`, { email: 'cookie6@example.com', password: 'contraseñaSegura123' });
    const { data } = await readJson<{ data: AuthData }>(reg);

    const headers = { 'x-request-id': 'req_cookie_access' }; // mismo id: cuerpos comparables
    const withCookie = await get(`${ctx.baseUrl}/auth/me`, undefined, {
      ...headers,
      cookie: `access_token=${data.accessToken}`,
    });
    const without = await get(`${ctx.baseUrl}/auth/me`, undefined, headers);
    expect(withCookie.status).toBe(401);
    expect(without.status).toBe(401);
    const a = await readJson<{ error: ErrorData }>(withCookie);
    const b = await readJson<{ error: ErrorData }>(without);
    expect(a).toEqual(b); // idénticos: la cookie de access no abre ninguna puerta
  });

  it('independencia de familias: reuso de la 1ª sesión no afecta a la 2ª', async () => {
    const email = 'cookie7@example.com';
    const reg = await post(`${ctx.baseUrl}/auth/register`, { email, password: 'contraseñaSegura123' });
    const { data: s1 } = await readJson<{ data: AuthData }>(reg);
    const log = await post(`${ctx.baseUrl}/auth/login`, { email, password: 'contraseñaSegura123' });
    const { data: s2 } = await readJson<{ data: AuthData }>(log);

    const rot1 = await post(`${ctx.baseUrl}/auth/refresh`, { refreshToken: s1.refreshToken });
    expect(rot1.status).toBe(200);
    const reuse = await post(`${ctx.baseUrl}/auth/refresh`, { refreshToken: s1.refreshToken }); // reuso → revoca SOLO familia 1
    expect(reuse.status).toBe(401);

    const after = await post(`${ctx.baseUrl}/auth/refresh`, { refreshToken: s2.refreshToken }); // familia 2 intacta
    expect(after.status).toBe(200);
  });
});