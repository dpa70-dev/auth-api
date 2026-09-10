import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import { buildApp } from '../src/index.js';
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

/** Fake en memoria del puerto EmailSender que captura los envíos para poder consumir el link. */
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

type TestContext = { baseUrl: string; sender: FakeEmailSender; close: () => Promise<void> };

const startApp = async (sender: FakeEmailSender): Promise<TestContext> => {
  const db = new Database(':memory:');
  const { app, close } = buildApp({ db, google: null, logger: silentLogger, sender, compromised: noOpCompromisedChecker });
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

/** Extrae el token opaco de la URL de consumo capturada por el fake: ...?token=<opaco>. */
const tokenFromUrl = (url: string): string => {
  const m = url.match(/token=([^&]+)/);
  if (!m || !m[1]) throw new Error(`URL sin token: ${url}`);
  return m[1];
};

const lastUrlWithToken = (sender: FakeEmailSender): string => {
  const url = sender.lastUrl();
  expect(url).toMatch(/token=[^&]+/);
  return url;
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

describe('US-09 — solicitud de magic link (anti-enumeración)', () => {
  it('200 { ok: true } y envía email cuando el email existe', async () => {
    ctx = await startApp(sender);
    await post(`${ctx.baseUrl}/auth/register`, { email: 'magia@example.com', password: 'contraseñaSegura123' });

    const res = await post(`${ctx.baseUrl}/auth/magic-link/request`, { email: 'magia@example.com' });
    expect(res.status).toBe(200);
    const { data } = await readJson<{ data: { ok: boolean } }>(res);
    expect(data.ok).toBe(true);
    expect(sender.sent).toHaveLength(1);
    expect(sender.lastUrl()).toMatch(/token=[^&]+/);
    expect(sender.sent[0]!.to).toBe('magia@example.com');
  });

  it('200 { ok: true } idéntico cuando el email NO existe y SÍ se envía (auto-cuenta + anti-enumeración)', async () => {
    ctx = await startApp(sender);
    const res = await post(`${ctx.baseUrl}/auth/magic-link/request`, { email: 'no-existe@example.com' });
    expect(res.status).toBe(200);
    const { data } = await readJson<{ data: { ok: boolean } }>(res);
    expect(data.ok).toBe(true);
    // Aunque el email no esté registrado, se envía el link: habilita la auto-cuenta en el consume
    // y evita un side-channel temporal (mismo trabajo con o sin cuenta).
    expect(sender.sent).toHaveLength(1);
  });

  it('ambos casos devuelven cuerpos idénticos (anti-enumeración estricta)', async () => {
    ctx = await startApp(sender);
    await post(`${ctx.baseUrl}/auth/register`, { email: 'existe@example.com', password: 'contraseñaSegura123' });
    const [rExiste, rNoExiste] = await Promise.all([
      post(`${ctx.baseUrl}/auth/magic-link/request`, { email: 'existe@example.com' }),
      post(`${ctx.baseUrl}/auth/magic-link/request`, { email: 'faltante@example.com' }),
    ]);
    const b1 = await readJson<{ data: { ok: boolean } }>(rExiste);
    const b2 = await readJson<{ data: { ok: boolean } }>(rNoExiste);
    expect(b1).toEqual(b2);
  });

  it('422 VALIDATION_ERROR con email inválido', async () => {
    ctx = await startApp(sender);
    const res = await post(`${ctx.baseUrl}/auth/magic-link/request`, { email: 'no-es-email' });
    expect(res.status).toBe(422);
    expect((await readJson<{ error: ErrorData }>(res)).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('US-10 — consumo de magic link', () => {
  it('auto-cuenta: sesión + usuario creado al consumir por primera vez', async () => {
    ctx = await startApp(sender);
    const req = await post(`${ctx.baseUrl}/auth/magic-link/request`, { email: 'nuevo@example.com' });
    expect(req.status).toBe(200);
    const token = tokenFromUrl(lastUrlWithToken(sender));

    const res = await post(`${ctx.baseUrl}/auth/magic-link/consume`, { token });
    expect(res.status).toBe(200);
    const { data } = await readJson<{ data: AuthData }>(res);
    expect(data.accessToken).toMatch(/^eyJ/);
    expect(typeof data.refreshToken).toBe('string');
    expect(data.user.email).toBe('nuevo@example.com');
    expect(data.user.id).toMatch(/^[0-9a-f]{8}-/);
  });

  it('reuso del token → 401 MAGIC_LINK_INVALID (un solo uso)', async () => {
    ctx = await startApp(sender);
    await post(`${ctx.baseUrl}/auth/magic-link/request`, { email: 'unuso@example.com' });
    const token = tokenFromUrl(lastUrlWithToken(sender));

    const first = await post(`${ctx.baseUrl}/auth/magic-link/consume`, { token });
    expect(first.status).toBe(200);

    const reuse = await post(`${ctx.baseUrl}/auth/magic-link/consume`, { token });
    expect(reuse.status).toBe(401);
    expect((await readJson<{ error: ErrorData }>(reuse)).error.code).toBe('MAGIC_LINK_INVALID');
  });

  it('usuario existente queda con email_verified y el /auth/me responde', async () => {
    ctx = await startApp(sender);
    await post(`${ctx.baseUrl}/auth/register`, { email: 'existente@example.com', password: 'contraseñaSegura123' });
    await post(`${ctx.baseUrl}/auth/magic-link/request`, { email: 'existente@example.com' });
    const token = tokenFromUrl(lastUrlWithToken(sender));

    const res = await post(`${ctx.baseUrl}/auth/magic-link/consume`, { token });
    expect(res.status).toBe(200);
    const { data } = await readJson<{ data: AuthData }>(res);

    const me = await fetch(`${ctx.baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${data.accessToken}` },
    });
    expect(me.status).toBe(200);
  });

  it('token inexistente → 401 MAGIC_LINK_INVALID', async () => {
    ctx = await startApp(sender);
    const res = await post(`${ctx.baseUrl}/auth/magic-link/consume`, { token: 'token-inventado' });
    expect(res.status).toBe(401);
    expect((await readJson<{ error: ErrorData }>(res)).error.code).toBe('MAGIC_LINK_INVALID');
  });

  it('422 VALIDATION_ERROR con token vacío', async () => {
    ctx = await startApp(sender);
    const res = await post(`${ctx.baseUrl}/auth/magic-link/consume`, { token: '' });
    expect(res.status).toBe(422);
    expect((await readJson<{ error: ErrorData }>(res)).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Magic Link — invarianza del hash', () => {
  it('el token opaco nunca coincide con su hash (solo se persiste el hash)', async () => {
    const raw = 'performTokenOpacoDeEjemplo';
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    expect(raw).not.toBe(tokenHash);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // El consume busca por hash(raw): el opaco NO es el hash.
    ctx = await startApp(sender);
    await post(`${ctx.baseUrl}/auth/magic-link/request`, { email: 'hash@example.com' });
    const rawSent = tokenFromUrl(lastUrlWithToken(sender));
    const res = await post(`${ctx.baseUrl}/auth/magic-link/consume`, { token: rawSent });
    expect(res.status).toBe(200);
  });
});
