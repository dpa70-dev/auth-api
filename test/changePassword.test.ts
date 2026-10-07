import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { buildApp } from '../src/api/appBuilder.js';
import type { CompromisedPasswordChecker, EmailSender, Logger } from '../src/domain/port/index.js';
import type { Email } from '../src/domain/vo/index.js';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };
/** Screen falso: ninguna contraseña está comprometida (los tests no pueden depender de la red). */
const noOpCompromisedChecker: CompromisedPasswordChecker = { check: async () => 'clean' };

type AuthData = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; createdAt: string };
};
type ErrorData = { code: string; message: string; requestId: string; details?: { field: string; issue: string }[] };
const readJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

/** Fake del puerto EmailSender: captura los envíos (necesita ambos canales para el caso solo-Google). */
class FakeEmailSender implements EmailSender {
  sent: { to: string; url: string }[] = [];
  sentReset: { to: string; url: string }[] = [];
  sentOtp: { to: string; code: string }[] = [];
  async sendMagicLink({ to, url }: { to: Email; url: string }): Promise<void> {
    this.sent.push({ to, url });
  }
  async sendPasswordResetEmail({ to, url }: { to: Email; url: string }): Promise<void> {
    this.sentReset.push({ to, url });
  }
  async sendOtpCode({ to, code }: { to: Email; code: string }): Promise<void> {
    this.sentOtp.push({ to, code });
  }
  lastUrl(): string {
    const last = this.sent.at(-1);
    if (!last) throw new Error('no se envió ningún magic link');
    return last.url;
  }
  lastResetUrl(): string {
    const last = this.sentReset.at(-1);
    if (!last) throw new Error('no se envió ningún email de reset');
    return last.url;
  }
}

type TestContext = { baseUrl: string; sender: FakeEmailSender; close: () => Promise<void> };

/** Arranca la app sobre un DB :memory:; el seed corre luego de las migraciones (boot) y antes de escuchar. */
const startApp = async (
  sender: FakeEmailSender,
  seed?: (db: Database.Database) => void,
): Promise<TestContext> => {
  const db = new Database(':memory:');
  const { app, close } = buildApp({ db, google: null, logger: silentLogger, sender, compromised: noOpCompromisedChecker });
  seed?.(db);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    sender,
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

const registerAndLogin = async (baseUrl: string, email: string, password: string): Promise<AuthData> => {
  const reg = await post(`${baseUrl}/auth/register`, { email, password });
  expect(reg.status).toBe(201);
  const login = await post(`${baseUrl}/auth/login`, { email, password });
  expect(login.status).toBe(200);
  return (await readJson<{ data: AuthData }>(login)).data;
};

const login = (baseUrl: string, email: string, password: string) =>
  post(`${baseUrl}/auth/login`, { email, password });

const changePassword = (
  baseUrl: string,
  token: string,
  body: { currentPassword: string; newPassword: string },
  headers: Record<string, string> = {},
) => post(`${baseUrl}/auth/change-password`, body, { authorization: `Bearer ${token}`, ...headers });

/** Token opaco de la URL de consumo capturada por el fake: ...?token=<opaco>. */
const tokenFromUrl = (url: string): string => {
  const m = url.match(/token=([^&]+)/);
  if (!m || !m[1]) throw new Error(`URL sin token: ${url}`);
  return m[1];
};

const consumeMagicLink = async (baseUrl: string, token: string): Promise<AuthData> => {
  const res = await post(`${baseUrl}/auth/magic-link/consume`, { token });
  expect(res.status).toBe(200);
  return (await readJson<{ data: AuthData }>(res)).data;
};

let ctx: TestContext;
let sender: FakeEmailSender;
beforeEach(() => {
  sender = new FakeEmailSender();
});
afterEach(async () => {
  if (ctx) await ctx.close();
  ctx = undefined as unknown as TestContext;
});

describe('US-11 — cambio de contraseña (autenticado)', () => {
  it('204 y la contraseña nueva autentica; la vieja deja de funcionar', async () => {
    ctx = await startApp(sender);
    await registerAndLogin(ctx.baseUrl, 'cambio@example.com', 'contraseñaVieja123');

    const resPwd = await login(ctx.baseUrl, 'cambio@example.com', 'contraseñaVieja123');
    const { data } = await readJson<{ data: AuthData }>(resPwd);
    const change = await changePassword(ctx.baseUrl, data.accessToken, {
      currentPassword: 'contraseñaVieja123',
      newPassword: 'contraseñaNueva123',
    });
    expect(change.status).toBe(204);

    const oldPwd = await login(ctx.baseUrl, 'cambio@example.com', 'contraseñaVieja123');
    expect(oldPwd.status).toBe(401);
    const newPwd = await login(ctx.baseUrl, 'cambio@example.com', 'contraseñaNueva123');
    expect(newPwd.status).toBe(200);
  });

  it('F1: el cambio revoca TODAS las sesiones emitidas bajo la contraseña vieja', async () => {
    ctx = await startApp(sender);
    const reg = await post(`${ctx.baseUrl}/auth/register`, { email: 'multisesion@example.com', password: 'contraseñaVieja123' });
    expect(reg.status).toBe(201);
    // Dos sesiones simultáneas con el MISMO secreto (dos logins).
    const loginA = await post(`${ctx.baseUrl}/auth/login`, { email: 'multisesion@example.com', password: 'contraseñaVieja123' });
    const loginB = await post(`${ctx.baseUrl}/auth/login`, { email: 'multisesion@example.com', password: 'contraseñaVieja123' });
    const first = (await readJson<{ data: AuthData }>(loginA)).data;
    const second = (await readJson<{ data: AuthData }>(loginB)).data;

    const change = await changePassword(ctx.baseUrl, first.accessToken, {
      currentPassword: 'contraseñaVieja123',
      newPassword: 'contraseñaNueva123',
    });
    expect(change.status).toBe(204);

    const refresh = (refreshToken: string) =>
      post(`${ctx.baseUrl}/auth/refresh`, { refreshToken });
    expect((await refresh(first.refreshToken)).status).toBe(401);
    expect((await refresh(second.refreshToken)).status).toBe(401);
  });

  it('401 INVALID_CREDENTIALS con currentPassword incorrecta', async () => {
    ctx = await startApp(sender);
    const auth = await registerAndLogin(ctx.baseUrl, 'malactual@example.com', 'contraseñaVieja123');

    const change = await changePassword(ctx.baseUrl, auth.accessToken, {
      currentPassword: 'otraContraseña',
      newPassword: 'contraseñaNueva123',
    });
    expect(change.status).toBe(401);
    expect((await readJson<{ error: ErrorData }>(change)).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('401 UNAUTHORIZED sin access token', async () => {
    ctx = await startApp(sender);
    const change = await changePassword(ctx.baseUrl, '', { currentPassword: 'x', newPassword: 'y' }, {});
    expect(change.status).toBe(401);
    expect((await readJson<{ error: ErrorData }>(change)).error.code).toBe('UNAUTHORIZED');
  });

  it('409 ACCOUNT_HAS_NO_PASSWORD para cuenta sin contraseña (auto-cuenta de magic link)', async () => {
    ctx = await startApp(sender);
    const req = await post(`${ctx.baseUrl}/auth/magic-link/request`, { email: 'sinpassword@example.com' });
    expect(req.status).toBe(200);
    const token = tokenFromUrl(sender.lastUrl());
    const viaLink = await consumeMagicLink(ctx.baseUrl, token);

    const change = await changePassword(ctx.baseUrl, viaLink.accessToken, {
      currentPassword: 'cualquiera123',
      newPassword: 'otraCualquiera123',
    });
    expect(change.status).toBe(409);
    expect((await readJson<{ error: ErrorData }>(change)).error.code).toBe('ACCOUNT_HAS_NO_PASSWORD');
  });

  it('409 ACCOUNT_HAS_NO_PASSWORD para cuenta solo-Google (passwordHash null)', async () => {
    ctx = await startApp(sender, (db) => {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, google_sub, email_verified, created_at)
         VALUES (?, ?, NULL, ?, 1, ?)`,
      ).run(randomUUID(), 'sologoogle@example.com', 'google_sub_1', new Date().toISOString());
    });
    // Sesión para el usuario sin google configurado: un magic link de login sobre el email existente.
    await post(`${ctx.baseUrl}/auth/magic-link/request`, { email: 'sologoogle@example.com' });
    const viaLink = await consumeMagicLink(ctx.baseUrl, tokenFromUrl(sender.lastUrl()));

    const change = await changePassword(ctx.baseUrl, viaLink.accessToken, {
      currentPassword: 'noImporta123',
      newPassword: 'tampocoImporta123',
    });
    expect(change.status).toBe(409);
    expect((await readJson<{ error: ErrorData }>(change)).error.code).toBe('ACCOUNT_HAS_NO_PASSWORD');
  });

  it('422 VALIDATION_ERROR con newPassword inválida', async () => {
    ctx = await startApp(sender);
    const auth = await registerAndLogin(ctx.baseUrl, 'cortita@example.com', 'contraseñaVieja123');

    const change = await changePassword(ctx.baseUrl, auth.accessToken, {
      currentPassword: 'contraseñaVieja123',
      newPassword: '123',
    });
    expect(change.status).toBe(422);
    expect((await readJson<{ error: ErrorData }>(change)).error.code).toBe('VALIDATION_ERROR');
  });
});