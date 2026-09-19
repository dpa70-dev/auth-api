import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Server } from 'node:http';
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

/** Fake en memoria del puerto EmailSender que captura los códigos OTP enviados. */
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
  lastOtpCode(): string {
    const last = this.sentOtp.at(-1);
    if (!last) throw new Error('no se envió ningún código OTP');
    return last.code;
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

let ctx: TestContext;
let sender: FakeEmailSender;
beforeEach(() => {
  sender = new FakeEmailSender();
});
afterEach(async () => {
  if (ctx) await ctx.close();
  ctx = undefined as unknown as TestContext;
});

describe('US-13 — solicitud de código OTP (anti-enumeración)', () => {
  it('200 { ok: true } y envía el código cuando el email existe', async () => {
    ctx = await startApp(sender);
    await post(`${ctx.baseUrl}/auth/register`, { email: 'otp@example.com', password: 'contraseñaSegura123' });

    const res = await post(`${ctx.baseUrl}/auth/otp/request`, { email: 'otp@example.com' });
    expect(res.status).toBe(200);
    const { data } = await readJson<{ data: { ok: boolean } }>(res);
    expect(data.ok).toBe(true);
    expect(sender.sentOtp).toHaveLength(1);
    expect(sender.sentOtp[0]!.to).toBe('otp@example.com');
    expect(sender.sentOtp[0]!.code).toMatch(/^[0-9]{6}$/);
  });

  it('200 { ok: true } idéntico cuando el email NO existe y SÍ se envía (auto-cuenta + anti-enumeración)', async () => {
    ctx = await startApp(sender);
    const res = await post(`${ctx.baseUrl}/auth/otp/request`, { email: 'no-existe@example.com' });
    expect(res.status).toBe(200);
    const { data } = await readJson<{ data: { ok: boolean } }>(res);
    expect(data.ok).toBe(true);
    // Aunque el email no esté registrado, se envía el código: habilita la auto-cuenta en el verify
    // y evita un side-channel temporal (mismo trabajo con o sin cuenta).
    expect(sender.sentOtp).toHaveLength(1);
  });

  it('ambos casos devuelven cuerpos idénticos (anti-enumeración estricta)', async () => {
    ctx = await startApp(sender);
    await post(`${ctx.baseUrl}/auth/register`, { email: 'existe@example.com', password: 'contraseñaSegura123' });
    const [rExiste, rNoExiste] = await Promise.all([
      post(`${ctx.baseUrl}/auth/otp/request`, { email: 'existe@example.com' }),
      post(`${ctx.baseUrl}/auth/otp/request`, { email: 'faltante@example.com' }),
    ]);
    const b1 = await readJson<{ data: { ok: boolean } }>(rExiste);
    const b2 = await readJson<{ data: { ok: boolean } }>(rNoExiste);
    expect(b1).toEqual(b2);
  });

  it('422 VALIDATION_ERROR con email inválido', async () => {
    ctx = await startApp(sender);
    const res = await post(`${ctx.baseUrl}/auth/otp/request`, { email: 'no-es-email' });
    expect(res.status).toBe(422);
    expect((await readJson<{ error: ErrorData }>(res)).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('US-14 — verificación de código OTP', () => {
  it('auto-cuenta: sesión + usuario creado al verificar por primera vez', async () => {
    ctx = await startApp(sender);
    const req = await post(`${ctx.baseUrl}/auth/otp/request`, { email: 'nuevo@example.com' });
    expect(req.status).toBe(200);
    const code = sender.lastOtpCode();

    const res = await post(`${ctx.baseUrl}/auth/otp/verify`, { email: 'nuevo@example.com', code });
    expect(res.status).toBe(200);
    const { data } = await readJson<{ data: AuthData }>(res);
    expect(data.accessToken).toMatch(/^eyJ/);
    expect(typeof data.refreshToken).toBe('string');
    expect(data.user.email).toBe('nuevo@example.com');
    expect(data.user.id).toMatch(/^[0-9a-f]{8}-/);

    const me = await fetch(`${ctx.baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${data.accessToken}` },
    });
    expect(me.status).toBe(200);
    // email_verified=1 lo cubre el unit test de VerifyOtp (GetMe no expone el flag).
  });

  it('código incorrecto → 401 OTP_INVALID idéntico a inexistente (anti-enumeración)', async () => {
    ctx = await startApp(sender);
    await post(`${ctx.baseUrl}/auth/otp/request`, { email: 'wrong@example.com' });
    const sent = sender.lastOtpCode();
    const wrong = sent === '000000' ? '111111' : '000000';

    const wrongRes = await post(`${ctx.baseUrl}/auth/otp/verify`, { email: 'wrong@example.com', code: wrong });
    const missingRes = await post(`${ctx.baseUrl}/auth/otp/verify`, { email: 'nunca-pedido@example.com', code: '123456' });
    expect(wrongRes.status).toBe(401);
    expect(missingRes.status).toBe(401);
    const b1 = await readJson<{ error: ErrorData }>(wrongRes);
    const b2 = await readJson<{ error: ErrorData }>(missingRes);
    expect(b1.error.code).toBe('OTP_INVALID');
    expect(b2.error.code).toBe('OTP_INVALID');
    // La forma es idéntica salvo requestId (único por request por diseño): code+message indistinguibles.
    expect(b1.error.code).toEqual(b2.error.code);
    expect(b1.error.message).toEqual(b2.error.message);
  });

  it('reuso del código → 401 OTP_INVALID (un solo uso)', async () => {
    ctx = await startApp(sender);
    await post(`${ctx.baseUrl}/auth/otp/request`, { email: 'unuso@example.com' });
    const code = sender.lastOtpCode();
    const body = { email: 'unuso@example.com', code };

    const first = await post(`${ctx.baseUrl}/auth/otp/verify`, body);
    expect(first.status).toBe(200);

    const reuse = await post(`${ctx.baseUrl}/auth/otp/verify`, body);
    expect(reuse.status).toBe(401);
    expect((await readJson<{ error: ErrorData }>(reuse)).error.code).toBe('OTP_INVALID');
  });

  it('5 fallos → el código queda revocado (6º intento 401 OTP_INVALID aunque sea el correcto)', async () => {
    ctx = await startApp(sender);
    await post(`${ctx.baseUrl}/auth/otp/request`, { email: 'limite@example.com' });
    const code = sender.lastOtpCode();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i += 1) {
      const res = await post(`${ctx.baseUrl}/auth/otp/verify`, { email: 'limite@example.com', code: wrong });
      expect(res.status).toBe(401);
      expect((await readJson<{ error: ErrorData }>(res)).error.code).toBe('OTP_INVALID');
    }

    const sixth = await post(`${ctx.baseUrl}/auth/otp/verify`, { email: 'limite@example.com', code });
    expect(sixth.status).toBe(401);
    expect((await readJson<{ error: ErrorData }>(sixth)).error.code).toBe('OTP_INVALID');
  });

  it('un nuevo request revoca el código anterior (rotación)', async () => {
    ctx = await startApp(sender);
    await post(`${ctx.baseUrl}/auth/otp/request`, { email: 'rota@example.com' });
    const firstCode = sender.lastOtpCode();
    await post(`${ctx.baseUrl}/auth/otp/request`, { email: 'rota@example.com' });

    const res = await post(`${ctx.baseUrl}/auth/otp/verify`, { email: 'rota@example.com', code: firstCode });
    expect(res.status).toBe(401);
    expect((await readJson<{ error: ErrorData }>(res)).error.code).toBe('OTP_INVALID');
  });

  it('el refresh token emitido es usable en /auth/refresh (rotación)', async () => {
    ctx = await startApp(sender);
    await post(`${ctx.baseUrl}/auth/otp/request`, { email: 'refresh@example.com' });
    const code = sender.lastOtpCode();

    const res = await post(`${ctx.baseUrl}/auth/otp/verify`, { email: 'refresh@example.com', code });
    expect(res.status).toBe(200);
    const { data } = await readJson<{ data: AuthData }>(res);
    const setCookie = res.headers.get('set-cookie') ?? '';
    const cookieToken = /refresh_token=([^;]+)/.exec(setCookie)?.[1] ?? data.refreshToken;

    const refresh = await post(`${ctx.baseUrl}/auth/refresh`, { refreshToken: cookieToken });
    expect(refresh.status).toBe(200);
    const { data: rotated } = await readJson<{ data: AuthData }>(refresh);
    expect(rotated.accessToken).toMatch(/^eyJ/);
  });

  it('422 VALIDATION_ERROR con código mal formado (no-6-dígitos)', async () => {
    ctx = await startApp(sender);
    const res = await post(`${ctx.baseUrl}/auth/otp/verify`, { email: 'formato@example.com', code: '12' });
    expect(res.status).toBe(422);
    expect((await readJson<{ error: ErrorData }>(res)).error.code).toBe('VALIDATION_ERROR');
  });
});