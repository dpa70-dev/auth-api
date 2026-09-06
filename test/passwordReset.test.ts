import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID, createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { buildApp } from '../src/index.js';
import type { EmailSender, Logger } from '../src/domain/port/index.js';
import type { Email } from '../src/domain/vo/index.js';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };

type AuthData = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; createdAt: string };
};
type ErrorData = { code: string; message: string; requestId: string; details?: { field: string; issue: string }[] };
const readJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

/** Fake del puerto EmailSender: canales separados para login y reset (assert por canal). */
class FakeEmailSender implements EmailSender {
  sent: { to: string; url: string }[] = [];
  sentReset: { to: string; url: string }[] = [];
  async sendMagicLink({ to, url }: { to: Email; url: string }): Promise<void> {
    this.sent.push({ to, url });
  }
  async sendPasswordResetEmail({ to, url }: { to: Email; url: string }): Promise<void> {
    this.sentReset.push({ to, url });
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

type TestContext = { baseUrl: string; sender: FakeEmailSender; db: Database.Database; close: () => Promise<void> };

/** Arranca la app sobre un DB :memory: (el db se expone para sembrar tokens vencidos). */
const startApp = async (sender: FakeEmailSender): Promise<TestContext> => {
  const db = new Database(':memory:');
  const { app, close } = buildApp({ db, google: null, logger: silentLogger, sender });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    sender,
    db,
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

const requestReset = async (baseUrl: string, email: string) =>
  post(`${baseUrl}/auth/magic-link/request`, { email, intent: 'password_reset' });

/** Token opaco de la URL de consumo capturada por el fake: ...?token=<opaco>. */
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

describe('US-12 — solicitud de reset (intent=password_reset)', () => {
  it('200 { ok: true } y el email sale por el canal de reset con la base de consumo del reset', async () => {
    ctx = await startApp(sender);
    await post(`${ctx.baseUrl}/auth/register`, { email: 'reset@example.com', password: 'contraseñaVieja123' });

    const res = await requestReset(ctx.baseUrl, 'reset@example.com');
    expect(res.status).toBe(200);
    expect((await readJson<{ data: { ok: boolean } }>(res)).data.ok).toBe(true);
    // El canal login NO recibe nada; el reset SÍ, con la base configurada MAGIC_LINK_PASSWORD_RESET_CONSUME_BASE_URL.
    expect(sender.sent).toHaveLength(0);
    expect(sender.sentReset).toHaveLength(1);
    expect(sender.sentReset[0]!.to).toBe('reset@example.com');
    expect(sender.lastResetUrl()).toMatch(
      /^http:\/\/localhost:3000\/api\/v1\/auth\/password\/reset\?token=/,
    );
  });

  it('intent omiso sigue siendo login (canal login, default)', async () => {
    ctx = await startApp(sender);
    const res = await post(`${ctx.baseUrl}/auth/magic-link/request`, { email: 'login@example.com' });
    expect(res.status).toBe(200);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sentReset).toHaveLength(0);
    expect(sender.lastUrl()).toMatch(/^http:\/\/localhost:3000\/api\/v1\/auth\/magic-link\/consume\?token=/);
  });

  it('422 VALIDATION_ERROR con intent desconocido', async () => {
    ctx = await startApp(sender);
    const res = await post(`${ctx.baseUrl}/auth/magic-link/request`, {
      email: 'intent@example.com',
      intent: 'otro',
    });
    expect(res.status).toBe(422);
    expect((await readJson<{ error: ErrorData }>(res)).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('US-12 — consumo de reset', () => {
  it('204 y permite login con la contraseña nueva; la vieja deja de funcionar', async () => {
    ctx = await startApp(sender);
    await post(`${ctx.baseUrl}/auth/register`, { email: 'reset@example.com', password: 'contraseñaVieja123' });
    await requestReset(ctx.baseUrl, 'reset@example.com');
    const token = tokenFromUrl(sender.lastResetUrl());

    const reset = await resetPassword(ctx.baseUrl, token, 'contraseñaNueva123');
    expect(reset.status).toBe(204);

    const oldPwd = await post(`${ctx.baseUrl}/auth/login`, { email: 'reset@example.com', password: 'contraseñaVieja123' });
    expect(oldPwd.status).toBe(401);
    const newPwd = await post(`${ctx.baseUrl}/auth/login`, { email: 'reset@example.com', password: 'contraseñaNueva123' });
    expect(newPwd.status).toBe(200);
    const { data } = await readJson<{ data: AuthData }>(newPwd);
    expect(data.user.email).toBe('reset@example.com');
  });

  it('F1: el reset revoca TODAS las sesiones previas (refresh viejo → 401)', async () => {
    ctx = await startApp(sender);
    const loginRes = await post(`${ctx.baseUrl}/auth/register`, { email: 'sesiones@example.com', password: 'contraseñaVieja123' });
    const { data } = await readJson<{ data: AuthData }>(loginRes);
    await requestReset(ctx.baseUrl, 'sesiones@example.com');
    const token = tokenFromUrl(sender.lastResetUrl());

    const reset = await resetPassword(ctx.baseUrl, token, 'contraseñaNueva123');
    expect(reset.status).toBe(204);

    const refresh = await post(`${ctx.baseUrl}/auth/refresh`, { refreshToken: data.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('F2: email no registrado → auto-registro local y login con la contraseña nueva', async () => {
    ctx = await startApp(sender);
    await requestReset(ctx.baseUrl, 'nuevo@example.com');
    const token = tokenFromUrl(sender.lastResetUrl());

    const reset = await resetPassword(ctx.baseUrl, token, 'contraseñaNueva123');
    expect(reset.status).toBe(204);

    const login = await post(`${ctx.baseUrl}/auth/login`, { email: 'nuevo@example.com', password: 'contraseñaNueva123' });
    expect(login.status).toBe(200);
    const { data } = await readJson<{ data: AuthData }>(login);
    expect(data.user.email).toBe('nuevo@example.com');
  });

  it('F3: un link de login no restablece contraseña (reset → 401 MAGIC_LINK_INVALID)', async () => {
    ctx = await startApp(sender);
    const req = await post(`${ctx.baseUrl}/auth/magic-link/request`, { email: 'x@example.com' });
    expect(req.status).toBe(200);
    const loginToken = tokenFromUrl(sender.lastUrl());

    const reset = await resetPassword(ctx.baseUrl, loginToken, 'contraseñaNueva123');
    expect(reset.status).toBe(401);
    expect((await readJson<{ error: ErrorData }>(reset)).error.code).toBe('MAGIC_LINK_INVALID');
  });

  it('F3: un link de reset no crea sesiones en /consume de login (consume → 401 MAGIC_LINK_INVALID)', async () => {
    ctx = await startApp(sender);
    await requestReset(ctx.baseUrl, 'y@example.com');
    const resetToken = tokenFromUrl(sender.lastResetUrl());

    const consume = await post(`${ctx.baseUrl}/auth/magic-link/consume`, { token: resetToken });
    expect(consume.status).toBe(401);
    expect((await readJson<{ error: ErrorData }>(consume)).error.code).toBe('MAGIC_LINK_INVALID');
  });

  it('reuso del token de reset → 401 MAGIC_LINK_INVALID (un solo uso)', async () => {
    ctx = await startApp(sender);
    await requestReset(ctx.baseUrl, 'unuso@example.com');
    const token = tokenFromUrl(sender.lastResetUrl());

    const first = await resetPassword(ctx.baseUrl, token, 'contraseñaNueva123');
    expect(first.status).toBe(204);
    const reuse = await resetPassword(ctx.baseUrl, token, 'otraContraseña123');
    expect(reuse.status).toBe(401);
    expect((await readJson<{ error: ErrorData }>(reuse)).error.code).toBe('MAGIC_LINK_INVALID');
  });

  it('token de reset vencido → 401 MAGIC_LINK_INVALID', async () => {
    ctx = await startApp(sender);
    const raw = 'tokenVencidoDeEjemplo';
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    ctx.db.prepare(
      `INSERT INTO magic_links (id, token_hash, email, purpose, status, expires_at, created_at)
       VALUES (?, ?, ?, 'password_reset', 'pending', ?, ?)`,
    ).run(randomUUID(), tokenHash, 'vencido@example.com', new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() - 120_000).toISOString());

    const reset = await resetPassword(ctx.baseUrl, raw, 'contraseñaNueva123');
    expect(reset.status).toBe(401);
    expect((await readJson<{ error: ErrorData }>(reset)).error.code).toBe('MAGIC_LINK_INVALID');
  });

  it('422 VALIDATION_ERROR con password inválida', async () => {
    ctx = await startApp(sender);
    await requestReset(ctx.baseUrl, 'valida@example.com');
    const token = tokenFromUrl(sender.lastResetUrl());

    const reset = await resetPassword(ctx.baseUrl, token, '123');
    expect(reset.status).toBe(422);
    expect((await readJson<{ error: ErrorData }>(reset)).error.code).toBe('VALIDATION_ERROR');
  });
});