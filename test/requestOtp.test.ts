import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { RequestOtp } from '../src/app/useCases/requestOtp.js';
import type { EmailSender, Logger, PasswordHasher } from '../src/domain/port/index.js';
import {
  emailSchema,
  otpStatusSchema,
  userIdSchema,
  userKindSchema,
  type Email,
  type PasswordHash,
  type PlainPassword,
} from '../src/domain/vo/index.js';
import { DrizzleOtpRepository } from '../src/infra/drizzleOtpRepository.js';
import { DrizzleUserRepository } from '../src/infra/drizzleUserRepository.js';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };
/** Hasher de test: hash determinista >= 20 chars (mínimo de passwordHashSchema), mismo patrón que unitOfWork.test.ts. */
const stubHasher: PasswordHasher = {
  hash: async (plain: PlainPassword): Promise<PasswordHash> => `stub-argon2-${plain}`.padEnd(20, 'x'),
  verify: async () => false,
};

class FakeEmailSender implements EmailSender {
  sent: { to: string; code: string }[] = [];
  async sendMagicLink(): Promise<void> {}
  async sendPasswordResetEmail(): Promise<void> {}
  async sendOtpCode({ to, code }: { to: Email; code: string }): Promise<void> {
    this.sent.push({ to, code });
  }
}

describe('RequestOtp — US-13 solicitud de código OTP', () => {
  let sqlite: Database.Database;
  let db: BetterSQLite3Database;
  let otpCodes: DrizzleOtpRepository;
  let users: DrizzleUserRepository;
  let sender: FakeEmailSender;
  const now = new Date('2026-01-01T00:00:00.000Z');

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    db = drizzle(sqlite);
    migrate(db, { migrationsFolder: './migrations' });
    otpCodes = new DrizzleOtpRepository(db);
    users = new DrizzleUserRepository(db);
    sender = new FakeEmailSender();
  });

  afterEach(() => {
    sqlite.close();
  });

  const ud = () => new RequestOtp(otpCodes, stubHasher, sender, silentLogger);

  it('emite código de 6 dígitos, lo persiste como pending con hash y TTL, y envía el email', async () => {
    await ud().execute({ email: emailSchema.parse('otp@example.com'), otpTtlMinutes: 5, now });

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.to).toBe('otp@example.com');
    expect(sender.sent[0]!.code).toMatch(/^[0-9]{6}$/);

    const row = await otpCodes.findPendingByEmail(emailSchema.parse('otp@example.com'), now.toISOString());
    expect(row).not.toBeNull();
    expect(row!.status).toBe(otpStatusSchema.enum.pending);
    expect(row!.attempts).toBe(0);
    // Hash del código (nunca el código plano) y expiración = now + TTL.
    expect(row!.codeHash).toBe(`stub-argon2-${sender.sent[0]!.code}`.padEnd(20, 'x'));
    expect(row!.expiresAt).toBe('2026-01-01T00:05:00.000Z');
  });

  it('un solo pendiente: revoca el código anterior antes de insertar el nuevo (rotación)', async () => {
    await ud().execute({ email: emailSchema.parse('otp@example.com'), otpTtlMinutes: 5, now });
    await ud().execute({ email: emailSchema.parse('otp@example.com'), otpTtlMinutes: 15, now });

    expect(sender.sent).toHaveLength(2);
    const pending = await otpCodes.findPendingByEmail(emailSchema.parse('otp@example.com'), now.toISOString());
    expect(pending).not.toBeNull();
    // El hash persistido corresponde al SEGUNDO código (el nuevo), no al primero.
    expect(pending!.codeHash).toBe(`stub-argon2-${sender.sent[1]!.code}`.padEnd(20, 'x'));
    expect(pending!.expiresAt).toBe('2026-01-01T00:15:00.000Z');
  });

  it('200 ok:true idéntico con y sin cuenta registrada (anti-enumeración — mismo trabajo)', async () => {
    await users.createUser({
      id: userIdSchema.parse(randomUUID()),
      email: emailSchema.parse('registrado@example.com'),
      passwordHash: await stubHasher.hash('contraseña123'),
      googleSub: null,
      emailVerified: false,
      kind: userKindSchema.enum.registered,
      createdAt: now.toISOString(),
    });

    const resWithAccount = await ud().execute({
      email: emailSchema.parse('registrado@example.com'),
      otpTtlMinutes: 5,
      now,
    });
    const resWithoutAccount = await ud().execute({
      email: emailSchema.parse('nunca-registrado@example.com'),
      otpTtlMinutes: 5,
      now,
    });

    // Respuesta, persistencia y envío idénticos en ambos caminos.
    expect(resWithAccount).toEqual({ ok: true });
    expect(resWithoutAccount).toEqual({ ok: true });
    expect(sender.sent).toHaveLength(2);
    const pendingFor = async (email: string) =>
      otpCodes.findPendingByEmail(emailSchema.parse(email), now.toISOString());
    expect(await pendingFor('registrado@example.com')).not.toBeNull();
    expect(await pendingFor('nunca-registrado@example.com')).not.toBeNull();
  });
});