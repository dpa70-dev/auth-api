import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Server } from 'node:http';
import { buildApp } from '../src/index.js';
import { CompositeCompromisedPasswordChecker } from '../src/infra/compositeCompromisedPasswordChecker.js';
import { HibpCompromisedPasswordChecker } from '../src/infra/hibpCompromisedPasswordChecker.js';
import { LocalCompromisedPasswordChecker } from '../src/infra/localCompromisedPasswordChecker.js';
import type { CompromisedPasswordChecker, EmailSender, Logger } from '../src/domain/port/index.js';
import type { Email } from '../src/domain/vo/index.js';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/** Fake del puerto EmailSender: captura el canal de reset para consumir el magic link. */
class FakeEmailSender implements EmailSender {
  sentReset: { to: string; url: string }[] = [];
  async sendMagicLink(): Promise<void> {}
  async sendPasswordResetEmail({ to, url }: { to: Email; url: string }): Promise<void> {
    this.sentReset.push({ to, url });
  }
  lastResetUrl(): string {
    const last = this.sentReset.at(-1);
    if (!last) throw new Error('no se envió ningún email de reset');
    return last.url;
  }
}

/** Screen configurable: marca como comprometidas SOLO las contraseñas exactas del arreglo. */
const rejectingChecker = (badPasswords: string[]): CompromisedPasswordChecker => ({
  check: async (pw) => (badPasswords.includes(pw) ? 'compromised' : 'clean'),
});

type TestContext = {
  baseUrl: string;
  sender: FakeEmailSender;
  close: () => Promise<void>;
};

const startApp = async (compromised: CompromisedPasswordChecker, sender: FakeEmailSender): Promise<TestContext> => {
  const db = new Database(':memory:');
  const { app, close } = buildApp({ db, google: null, logger: silentLogger, sender, compromised });
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

type AuthData = { accessToken: string; refreshToken: string; user: { id: string; email: string; createdAt: string } };
type ErrorData = { code: string; message: string; requestId: string; details?: { field: string; issue: string }[] };
const readJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

const register = (baseUrl: string, email: string, password: string) =>
  post(`${baseUrl}/auth/register`, { email, password });

const registerAndLogin = async (baseUrl: string, email: string, password: string): Promise<AuthData> => {
  expect((await register(baseUrl, email, password)).status).toBe(201);
  const login = await post(`${baseUrl}/auth/login`, { email, password });
  expect(login.status).toBe(200);
  return (await readJson<{ data: AuthData }>(login)).data;
};

/** Token opaco de la URL de reset capturada por el fake: ...?token=<opaco>. */
const tokenFromUrl = (url: string): string => {
  const m = url.match(/token=([^&]+)/);
  if (!m || !m[1]) throw new Error(`URL sin token: ${url}`);
  return m[1];
};

const resetPassword = (baseUrl: string, token: string, password: string) =>
  post(`${baseUrl}/auth/password/reset`, { token, password });

let ctx: TestContext;
let sender: FakeEmailSender;
beforeEach(() => {
  sender = new FakeEmailSender();
});
afterEach(async () => {
  if (ctx) await ctx.close();
  ctx = undefined as unknown as TestContext;
});

describe('NIST 800-63B §5.1.1.2 — rechazo de contraseñas comprometidas', () => {
  it('register: 422 PASSWORD_COMPROMISED con details.field password', async () => {
    ctx = await startApp(rejectingChecker(['comprometida123']), sender);

    const res = await register(ctx.baseUrl, 'filtrada@example.com', 'comprometida123');

    expect(res.status).toBe(422);
    const { error } = await readJson<{ error: ErrorData }>(res);
    expect(error.code).toBe('PASSWORD_COMPROMISED');
    expect(error.details).toEqual([{ field: 'password', issue: 'compromised' }]);
  });

  it('register: tras un rechazo, el mismo email se registra con una contraseña limpia (no quedó cuenta a medias)', async () => {
    ctx = await startApp(rejectingChecker(['comprometida123']), sender);

    expect((await register(ctx.baseUrl, 'recupera@example.com', 'comprometida123')).status).toBe(422);
    const retry = await register(ctx.baseUrl, 'recupera@example.com', 'contraseñaLimpia123');

    expect(retry.status).toBe(201);
  });

  it('change-password: 422 con details.field newPassword y la sesión actual sigue viva', async () => {
    ctx = await startApp(rejectingChecker(['comprometidaNueva123']), sender);
    const auth = await registerAndLogin(ctx.baseUrl, 'cambia@example.com', 'contraseñaVieja123');

    const change = await post(`${ctx.baseUrl}/auth/change-password`, {
      currentPassword: 'contraseñaVieja123',
      newPassword: 'comprometidaNueva123',
    }, { authorization: `Bearer ${auth.accessToken}` });

    expect(change.status).toBe(422);
    const { error } = await readJson<{ error: ErrorData }>(change);
    expect(error.code).toBe('PASSWORD_COMPROMISED');
    expect(error.details).toEqual([{ field: 'newPassword', issue: 'compromised' }]);
    // La revocación de sesiones solo ocurre si el cambio CONCRETA — tras el rechazo la vieja sigue autenticando.
    expect((await post(`${ctx.baseUrl}/auth/login`, { email: 'cambia@example.com', password: 'contraseñaVieja123' })).status).toBe(200);
  });

  it('reset: 422 y el magic link NO se consume (reintentar con contraseña limpia funciona)', async () => {
    ctx = await startApp(rejectingChecker(['comprometidaReset123']), sender);
    await register(ctx.baseUrl, 'reset@example.com', 'contraseñaVieja123');
    await post(`${ctx.baseUrl}/auth/magic-link/request`, { email: 'reset@example.com', intent: 'password_reset' });
    const token = tokenFromUrl(sender.lastResetUrl());

    const rejected = await resetPassword(ctx.baseUrl, token, 'comprometidaReset123');

    expect(rejected.status).toBe(422);
    const { error } = await readJson<{ error: ErrorData }>(rejected);
    expect(error.code).toBe('PASSWORD_COMPROMISED');

    // El link es de un solo uso (patrón consume): al NO consumirse, reusarlo con buena contraseña aún funciona.
    const retry = await resetPassword(ctx.baseUrl, token, 'contraseñaNueva123');
    expect(retry.status).toBe(204);
    expect((await post(`${ctx.baseUrl}/auth/login`, { email: 'reset@example.com', password: 'contraseñaNueva123' })).status).toBe(200);
  });

  it('fallback local del composite: con HIBP en outage, una contraseña top-100 embebida se rechaza (422) y una limpia pasa', async () => {
    const outageFetch = vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const composite = new CompositeCompromisedPasswordChecker(
      new HibpCompromisedPasswordChecker(silentLogger, outageFetch),
      new LocalCompromisedPasswordChecker(silentLogger),
      silentLogger,
    );
    ctx = await startApp(composite, sender);

    const rejected = await register(ctx.baseUrl, 'outage@example.com', 'password');
    expect(rejected.status).toBe(422);
    const { error } = await readJson<{ error: ErrorData }>(rejected);
    expect(error.code).toBe('PASSWORD_COMPROMISED');

    const allowed = await register(ctx.baseUrl, 'outage2@example.com', 'contraseñaSegura123');
    expect(allowed.status).toBe(201);
  });
});