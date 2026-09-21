import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UpgradeGuestAccount } from '../src/app/useCases/index.js';
import type { CompromisedPasswordChecker, Logger, PasswordHasher, UserRepository } from '../src/domain/port/index.js';
import {
  emailSchema,
  familyIdSchema,
  jtiSchema,
  providerSchema,
  refreshTokenStatusSchema,
  userIdSchema,
  userKindSchema,
  type Email,
  type PasswordHash,
  type PlainPassword,
  type UserId,
} from '../src/domain/vo/index.js';
import { DrizzleUserRepository } from '../src/infra/db/drizzleUserRepository.js';
import { SqliteUnitOfWork } from '../src/infra/db/sqliteUnitOfWork.js';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };
/** Hasher de test que SÍ verifica: hash determinista >= 20 chars (mínimo de passwordHashSchema). */
const verifyHasher: PasswordHasher = {
  hash: async (plain: PlainPassword): Promise<PasswordHash> => `stub-argon2-${plain}`.padEnd(20, 'x'),
  verify: async (plain: PlainPassword, hash: PasswordHash | null): Promise<boolean> =>
    hash != null && hash === `stub-argon2-${plain}`.padEnd(20, 'x'),
};
/** Checker configurable: por defecto 'clean'; los tests de rechazo lo ponen en 'compromised'. */
const makeChecker = (result: 'clean' | 'compromised' = 'clean'): CompromisedPasswordChecker => ({
  check: async () => result,
});

describe('UpgradeGuestAccount — US-16 reclamo de identidad de cuenta guest', () => {
  let sqlite: Database.Database;
  let db: BetterSQLite3Database;
  let users: UserRepository;
  let uow: SqliteUnitOfWork;
  const email = (s: string): Email => emailSchema.parse(s);

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    db = drizzle(sqlite);
    migrate(db, { migrationsFolder: './migrations' });
    users = new DrizzleUserRepository(db);
    uow = new SqliteUnitOfWork(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  const upgrade = (compromised: CompromisedPasswordChecker = makeChecker()) =>
    new UpgradeGuestAccount(users, verifyHasher, compromised, uow, silentLogger);

  /** Crea un guest anónimo (US-15) directamente en el repo — mismo shape que CreateGuestSession. */
  const insertGuest = async (): Promise<UserId> => {
    const id = userIdSchema.parse(randomUUID());
    await users.createUser({
      id,
      email: null,
      passwordHash: null,
      googleSub: null,
      emailVerified: false,
      kind: userKindSchema.enum.guest,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    return id;
  };

  /** Inserta un refresh token activo para el user (sesión guest legítima). */
  const insertActiveRefresh = async (userId: UserId): Promise<string> => {
    const tokenHash = `stub-refresh-${randomUUID()}`;
    await users.insertRefreshToken({
      jti: jtiSchema.parse(randomUUID()),
      tokenHash,
      userId,
      familyId: familyIdSchema.parse(randomUUID()),
      provider: providerSchema.enum.guest,
      expiresAt: '2027-01-01T00:00:00.000Z',
    });
    return tokenHash;
  };

  it('guest → registered ok: email+kind actualizados, email_verified queda false', async () => {
    const guestId = await insertGuest();
    const to = email('cliente@example.com');

    const result = await upgrade().execute({ userId: guestId, email: to, password: 'nueva-Pass-123' });

    expect(result.id).toBe(guestId);
    expect(result.email).toBe(to);
    expect(result.kind).toBe(userKindSchema.enum.registered);

    const user = await users.findById(guestId);
    expect(user).not.toBeNull();
    expect(user!.email).toBe(to);
    expect(user!.passwordHash).not.toBeNull();
    expect(user!.kind).toBe(userKindSchema.enum.registered);
    expect(user!.emailVerified).toBe(false);
  });

  it('la sesión guest NO se revoca: el refresh row sigue activo tras el upgrade', async () => {
    const guestId = await insertGuest();
    const tokenHash = await insertActiveRefresh(guestId);

    await upgrade().execute({ userId: guestId, email: email('sin-revoke@example.com'), password: 'nueva-Pass-123' });

    const row = await users.findByRefreshTokenHash(tokenHash);
    expect(row).not.toBeNull();
    expect(row!.status).toBe(refreshTokenStatusSchema.enum.active);
    expect(row!.provider).toBe(providerSchema.enum.guest);
  });

  it('cuenta no-guest (registered) → 409 GUEST_UPGRADE_INVALID', async () => {
    const id = userIdSchema.parse(randomUUID());
    await users.createUser({
      id,
      email: email('local@example.com'),
      passwordHash: await verifyHasher.hash('contraseña123'),
      googleSub: null,
      emailVerified: false,
      kind: userKindSchema.enum.registered,
      createdAt: '2025-01-01T00:00:00.000Z',
    });

    await expect(
      upgrade().execute({ userId: id, email: email('otro@example.com'), password: 'nueva-Pass-123' }),
    ).rejects.toMatchObject({ code: 'GUEST_UPGRADE_INVALID' });
  });

  it('email ya usado por OTRA cuenta → 409 EMAIL_ALREADY_EXISTS (sin auto-linking)', async () => {
    const occupied = email('ocupado@example.com');
    await users.createUser({
      id: userIdSchema.parse(randomUUID()),
      email: occupied,
      passwordHash: await verifyHasher.hash('otra-Contraseña1'),
      googleSub: null,
      emailVerified: false,
      kind: userKindSchema.enum.registered,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const guestId = await insertGuest();

    await expect(
      upgrade().execute({ userId: guestId, email: occupied, password: 'nueva-Pass-123' }),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_EXISTS' });
  });

  it('contraseña comprometida → PASSWORD_COMPROMISED (mismo pipeline NIST que register)', async () => {
    const guestId = await insertGuest();

    await expect(
      upgrade(makeChecker('compromised')).execute({
        userId: guestId,
        email: email('pasada@example.com'),
        password: 'contraseña-viejísima-1',
      }),
    ).rejects.toMatchObject({ code: 'PASSWORD_COMPROMISED' });
  });

  it('userId inexistente + requireAuth roto → 401 UNAUTHORIZED (guard defensivo)', async () => {
    const ghost = userIdSchema.parse('00000000-0000-4000-8000-000000000000');
    await expect(
      upgrade().execute({ userId: ghost, email: email('fantasma@example.com'), password: 'nueva-Pass-123' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});