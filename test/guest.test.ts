import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Server } from 'node:http';
import { buildApp } from '../src/index.js';
import type { CompromisedPasswordChecker, Logger } from '../src/domain/port/index.js';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };
/** Screen falso: ninguna contraseña está comprometida (los tests no pueden depender de la red). */
const noOpCompromisedChecker: CompromisedPasswordChecker = { check: async () => 'clean' };

// Formas del envelope del contrato docs/03 → la cuenta guest expone email null + kind.
type AuthData = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string | null; kind: 'registered' | 'guest'; createdAt: string };
};
type MeData = { id: string; email: string | null; kind: 'registered' | 'guest'; createdAt: string };
type ErrorData = { code: string; message: string; requestId: string; details?: { field: string; issue: string }[] };
/** @types/node 26 tipa Response.json() como Promise<unknown> — cast al modelo del contrato. */
const readJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

type TestContext = { baseUrl: string; close: () => Promise<void> };

const startApp = async (): Promise<TestContext> => {
  const db = new Database(':memory:');
  const { app, close } = buildApp({ db, google: null, logger: silentLogger, compromised: noOpCompromisedChecker });
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

describe('US-15 — sesión de invitado POST /auth/guest', () => {
  it('200 AuthResponse con user.kind=\'guest\' y email null', async () => {
    const res = await post(`${ctx.baseUrl}/auth/guest`, {});
    expect(res.status).toBe(200);
    const { data } = await readJson<{ data: AuthData }>(res);
    expect(data.accessToken).toMatch(/^eyJ/);
    expect(typeof data.refreshToken).toBe('string');
    expect(data.user.kind).toBe('guest');
    expect(data.user.email).toBeNull();
    expect(data.user.id).toMatch(/^[0-9a-f]{8}-/);
  });

  it('/auth/me con el Bearer guest responde con email null y kind guest', async () => {
    const guest = await post(`${ctx.baseUrl}/auth/guest`, {});
    const { data } = await readJson<{ data: AuthData }>(guest);

    const res = await get(`${ctx.baseUrl}/auth/me`, data.accessToken);
    expect(res.status).toBe(200);
    const me = await readJson<{ data: MeData }>(res);
    expect(me.data).toEqual({ id: me.data.id, email: null, kind: 'guest', createdAt: me.data.createdAt });
  });

  it('dos requests crean dos guest distintos (sin dedup)', async () => {
    const [a, b] = await Promise.all([
      post(`${ctx.baseUrl}/auth/guest`, {}),
      post(`${ctx.baseUrl}/auth/guest`, {}),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const da = await readJson<{ data: AuthData }>(a);
    const db = await readJson<{ data: AuthData }>(b);
    expect(da.data.user.id).not.toBe(db.data.user.id);
  });

  it('el refresh emitido rota en /auth/refresh (la sesión guest es una sesión normal)', async () => {
    const guest = await post(`${ctx.baseUrl}/auth/guest`, {});
    const { data } = await readJson<{ data: AuthData }>(guest);
    const setCookie = guest.headers.get('set-cookie') ?? '';
    const cookieToken = /refresh_token=([^;]+)/.exec(setCookie)?.[1] ?? data.refreshToken;

    const refresh = await post(`${ctx.baseUrl}/auth/refresh`, { refreshToken: cookieToken });
    expect(refresh.status).toBe(200);
    const { data: rotated } = await readJson<{ data: AuthData }>(refresh);
    expect(rotated.accessToken).toMatch(/^eyJ/);
  });
});

describe('US-16 — upgrade de cuenta POST /auth/guest/upgrade', () => {
  const createGuest = async (): Promise<AuthData> => {
    const res = await post(`${ctx.baseUrl}/auth/guest`, {});
    const { data } = await readJson<{ data: AuthData }>(res);
    return data;
  };

  it('200 convierte a registered (email + kind) y NO revoca la sesión (el refresh sigue sirviendo)', async () => {
    const guest = await createGuest();

    const up = await post(`${ctx.baseUrl}/auth/guest/upgrade`, { email: 'guest@example.com', password: 'contraseñaSegura123' }, { authorization: `Bearer ${guest.accessToken}` });
    expect(up.status).toBe(200);
    const { data: upgraded } = await readJson<{ data: MeData }>(up);
    expect(upgraded).toEqual({ id: guest.user.id, email: 'guest@example.com', kind: 'registered', createdAt: upgraded.createdAt });

    // Decisión aprobada (plan): el upgrade NO revoca sesiones → el mismo refresh sigue rotando.
    const refresh = await post(`${ctx.baseUrl}/auth/refresh`, { refreshToken: guest.refreshToken });
    expect(refresh.status).toBe(200);
    const { data: rotated } = await readJson<{ data: { accessToken: string; refreshToken: string } }>(refresh);

    // El access rotado identifica la cuenta ya registrada (kind registered tras el upgrade).
    const me = await get(`${ctx.baseUrl}/auth/me`, rotated.accessToken);
    expect(me.status).toBe(200);
    const profile = await readJson<{ data: MeData }>(me);
    expect(profile.data.kind).toBe('registered');
  });

  it('el perfil /auth/me tras el upgrade refleja email + kind registered', async () => {
    const guest = await createGuest();
    await post(`${ctx.baseUrl}/auth/guest/upgrade`, { email: 'me-guest@example.com', password: 'contraseñaSegura123' }, { authorization: `Bearer ${guest.accessToken}` });

    const res = await get(`${ctx.baseUrl}/auth/me`, guest.accessToken);
    expect(res.status).toBe(200);
    const me = await readJson<{ data: MeData }>(res);
    expect(me.data.email).toBe('me-guest@example.com');
    expect(me.data.kind).toBe('registered');
  });

  it('email ya usado por otra cuenta → 409 EMAIL_ALREADY_EXISTS', async () => {
    await post(`${ctx.baseUrl}/auth/register`, { email: 'ocupado@example.com', password: 'contraseñaSegura123' });
    const guest = await createGuest();

    const up = await post(`${ctx.baseUrl}/auth/guest/upgrade`, { email: 'ocupado@example.com', password: 'contraseñaSegura123' }, { authorization: `Bearer ${guest.accessToken}` });
    expect(up.status).toBe(409);
    expect((await readJson<{ error: ErrorData }>(up)).error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('cuenta local (no guest) → 409 GUEST_UPGRADE_INVALID', async () => {
    const reg = await post(`${ctx.baseUrl}/auth/register`, { email: 'local@example.com', password: 'contraseñaSegura123' });
    const { data: local } = await readJson<{ data: AuthData }>(reg);

    const up = await post(`${ctx.baseUrl}/auth/guest/upgrade`, { email: 'otro@example.com', password: 'contraseñaSegura123' }, { authorization: `Bearer ${local.accessToken}` });
    expect(up.status).toBe(409);
    expect((await readJson<{ error: ErrorData }>(up)).error.code).toBe('GUEST_UPGRADE_INVALID');
  });

  it('sin Bearer → 401 UNAUTHORIZED', async () => {
    const res = await post(`${ctx.baseUrl}/auth/guest/upgrade`, { email: 'x@example.com', password: 'contraseñaSegura123' });
    expect(res.status).toBe(401);
    expect((await readJson<{ error: ErrorData }>(res)).error.code).toBe('UNAUTHORIZED');
  });

  it('422 VALIDATION_ERROR con shapes inválidos (email malo / password corta)', async () => {
    const guest = await createGuest();
    const h = { authorization: `Bearer ${guest.accessToken}` };

    const badEmail = await post(`${ctx.baseUrl}/auth/guest/upgrade`, { email: 'no-es-email', password: 'contraseñaSegura123' }, h);
    expect(badEmail.status).toBe(422);
    expect((await readJson<{ error: ErrorData }>(badEmail)).error.code).toBe('VALIDATION_ERROR');

    const shortPw = await post(`${ctx.baseUrl}/auth/guest/upgrade`, { email: 'ok@example.com', password: 'corta' }, h);
    expect(shortPw.status).toBe(422);
  });

  it('429 al exceder el authLimiter (11º request por IP)', async () => {
    // App fresca para contar la ventana desde cero (el limiter es por instancia de app).
    await ctx.close();
    ctx = await startApp();

    let status = 0;
    for (let i = 0; i < 11; i += 1) {
      const res = await post(`${ctx.baseUrl}/auth/guest`, {});
      status = res.status;
    }
    expect(status).toBe(429);
    expect((await readJson<{ error: ErrorData }>(await post(`${ctx.baseUrl}/auth/guest`, {}))).error.code).toBe('RATE_LIMITED');
  });
});