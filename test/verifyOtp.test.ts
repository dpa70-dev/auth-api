import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { RequestOtp, VerifyOtp, OTP_MAX_ATTEMPTS } from '../src/app/useCases/index.js';
import type { EmailSender, Logger, PasswordHasher, TokenIssuer } from '../src/domain/port/index.js';
import {
  emailSchema,
  otpCodeSchema,
  otpStatusSchema,
  providerSchema,
  userIdSchema,
  userKindSchema,
  userRoleSchema,
  userStatusSchema,
  type Email,
  type PasswordHash,
  type PlainPassword,
} from '../src/domain/vo/index.js';
import { DrizzleOtpRepository } from '../src/infra/db/drizzleOtpRepository.js';
import { DrizzleRefreshTokenRepository } from '../src/infra/db/drizzleRefreshTokenRepository.js';
import { DrizzleUserRepository } from '../src/infra/db/drizzleUserRepository.js';
import { JoseTokenService } from '../src/infra/tokens/joseTokenService.js';
import { SqliteUnitOfWork } from '../src/infra/db/sqliteUnitOfWork.js';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };
/** Hasher de test que SÍ verifica: hash determinista >= 20 chars (mínimo de passwordHashSchema). */
const verifyHasher: PasswordHasher = {
  hash: async (plain: PlainPassword): Promise<PasswordHash> => `stub-argon2-${plain}`.padEnd(20, 'x'),
  verify: async (plain: PlainPassword, hash: PasswordHash | null): Promise<boolean> =>
    hash != null && hash === `stub-argon2-${plain}`.padEnd(20, 'x'),
};

class FakeEmailSender implements EmailSender {
  sent: { to: string; code: string }[] = [];
  async sendMagicLink(): Promise<void> {}
  async sendPasswordResetEmail(): Promise<void> {}
  async sendOtpCode({ to, code }: { to: Email; code: string }): Promise<void> {
    this.sent.push({ to, code });
  }
}

describe('VerifyOtp — US-14 verificación de código OTP', () => {
  let sqlite: Database.Database;
  let db: BetterSQLite3Database;
  let otpCodes: DrizzleOtpRepository;
  let users: DrizzleUserRepository;
  let refreshTokens: DrizzleRefreshTokenRepository;
  let uow: SqliteUnitOfWork;
  let sender: FakeEmailSender;
  const now = new Date('2026-01-01T00:00:00.000Z');
  const email = (s: string): Email => emailSchema.parse(s);
  const code = (s: string) => otpCodeSchema.parse(s);
  const tokens: TokenIssuer = new JoseTokenService(new TextEncoder().encode('test-secret-para-otp-verify-000'), 15);

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    db = drizzle(sqlite);
    migrate(db, { migrationsFolder: './migrations' });
    otpCodes = new DrizzleOtpRepository(db);
    users = new DrizzleUserRepository(db);
    refreshTokens = new DrizzleRefreshTokenRepository(db);
    uow = new SqliteUnitOfWork(sqlite);
    sender = new FakeEmailSender();
  });

  afterEach(() => {
    sqlite.close();
  });

  const verifyOtp = () =>
    new VerifyOtp(users, otpCodes, verifyHasher, tokens, uow, silentLogger, refreshTokens);

  /** Emite un código real vía RequestOtp y devuelve el 6-dígitos que capturó el emisor. */
  const requestCode = async (to: Email, ttlMinutes = 5): Promise<string> => {
    await new RequestOtp(otpCodes, verifyHasher, sender, silentLogger).execute({
      email: to,
      otpTtlMinutes: ttlMinutes,
      now,
    });
    const last = sender.sent.at(-1);
    if (!last) throw new Error('no se envió ningún código OTP');
    return last.code;
  };

  const rowOf = (to: Email) =>
    sqlite.prepare('SELECT status, attempts, expires_at FROM otp_codes WHERE email = ?').get(to) as
      | { status: string; attempts: number; expires_at: string }
      | undefined;

  it('código válido → emite sesión (access+refresh), marca used y persiste provider otp', async () => {
    const to = email('valid@example.com');
    const rawCode = await requestCode(to);

    const result = await verifyOtp().execute({ email: to, code: code(rawCode), refreshTtlDays: 30, now });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.email).toBe(to);
    expect(rowOf(to)!.status).toBe(otpStatusSchema.enum.used);
    const row = sqlite
      .prepare('SELECT provider FROM refresh_tokens WHERE user_id = ?')
      .get(result.user.id) as { provider: string };
    expect(row.provider).toBe(providerSchema.enum.otp);
  });

  it('auto-cuenta: email no registrado → usuario con email_verified=1 y sin password', async () => {
    const to = email('nueva-cuenta@example.com');
    const rawCode = await requestCode(to);

    const result = await verifyOtp().execute({ email: to, code: code(rawCode), refreshTtlDays: 30, now });

    const user = await users.findByEmail(to);
    expect(user).not.toBeNull();
    expect(user!.emailVerified).toBe(true);
    expect(user!.passwordHash).toBeNull();
    expect(result.user.email).toBe(to);
  });

  it('cuenta local existente → sesión sobre la misma cuenta y email_verified marcado', async () => {
    const to = email('local@example.com');
    await users.createUser({
      id: userIdSchema.parse(randomUUID()),
      email: to,
      passwordHash: await verifyHasher.hash('contraseña123'),
      googleSub: null,
      emailVerified: false,
      kind: userKindSchema.enum.registered,
      role: userRoleSchema.enum.user,
      status: userStatusSchema.enum.active,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const rawCode = await requestCode(to);

    await verifyOtp().execute({ email: to, code: code(rawCode), refreshTtlDays: 30, now });

    const user = await users.findByEmail(to);
    expect(user).not.toBeNull();
    expect(user!.emailVerified).toBe(true);
    expect(user!.passwordHash).not.toBeNull(); // mantiene su vía local
  });

  it('código incorrecto → 401 OTP_INVALID idéntico y cuenta el intento', async () => {
    const to = email('wrong@example.com');
    const rawCode = await requestCode(to);
    const wrong = rawCode === '000000' ? '000001' : '000000';

    await expect(verifyOtp().execute({ email: to, code: code(wrong), refreshTtlDays: 30, now })).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
    expect(rowOf(to)!.attempts).toBe(1);
    expect(rowOf(to)!.status).toBe(otpStatusSchema.enum.pending); // sigue pendiente tras un fallo
  });

  it('sin código previo para el email → 401 OTP_INVALID idéntico (inexistente)', async () => {
    await expect(
      verifyOtp().execute({ email: email('nunca-pedido@example.com'), code: code('123456'), refreshTtlDays: 30, now }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID' });
  });

  it('código vencido → 401 OTP_INVALID idéntico', async () => {
    const to = email('vencido@example.com');
    await otpCodes.insert({
      id: randomUUID(),
      email: to,
      codeHash: await verifyHasher.hash('123456'),
      expiresAt: '2025-12-31T23:59:59.000Z',
    });

    await expect(verifyOtp().execute({ email: to, code: code('123456'), refreshTtlDays: 30, now })).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
  });

  it('código reutilizado (segunda verificación) → 401 OTP_INVALID idéntico (un solo uso)', async () => {
    const to = email('reuse@example.com');
    const rawCode = await requestCode(to);
    const cmd = { email: to, code: code(rawCode), refreshTtlDays: 30, now };

    await verifyOtp().execute(cmd);
    await expect(verifyOtp().execute(cmd)).rejects.toMatchObject({ code: 'OTP_INVALID' });
    // El código correcto presentado al límite de intentos también es rechazado (anti-bruteforce):
    expect(rowOf(to)!.status).toBe(otpStatusSchema.enum.used);
  });

  it(`límite de ${OTP_MAX_ATTEMPTS} fallos: el siguiente intento revoca el código y sigue siendo 401`, async () => {
    const to = email('fuerza-bruta@example.com');
    const rawCode = await requestCode(to);
    const wrong = rawCode === '000000' ? '000001' : '000000';

    // N fallos: cada uno es 401 y acumula el intento.
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      await expect(
        verifyOtp().execute({ email: to, code: code(wrong), refreshTtlDays: 30, now }),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    }
    expect(rowOf(to)!.attempts).toBe(OTP_MAX_ATTEMPTS);

    // El siguiente intento (aunque el código sea el correcto) revoca y sigue siendo 401.
    await expect(verifyOtp().execute({ email: to, code: code(rawCode), refreshTtlDays: 30, now })).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
    expect(rowOf(to)!.status).toBe(otpStatusSchema.enum.revoked);
  });

  it('el 401 es indistinguible entre fallos: mismo code OTP_INVALID en todos los caminos', async () => {
    const to = email('indistinguible@example.com');
    const rawCode = await requestCode(to);
    const wrong = rawCode === '000000' ? '000001' : '000000';
    const outcomes = await Promise.all([
      verifyOtp().execute({ email: to, code: code(wrong), refreshTtlDays: 30, now }).catch((e) => e),
      verifyOtp().execute({ email: email('sin-codigo@example.com'), code: code(wrong), refreshTtlDays: 30, now }).catch((e) => e),
    ]);
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ code: 'OTP_INVALID' });
    }
  });
});